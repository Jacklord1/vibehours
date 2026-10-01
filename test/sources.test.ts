// Made-up hosts and files only.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { isZone, loadSettings, saveSettings } from "../src/main/settings";
import {
  REMOTE_COMMANDS,
  fetchLocal,
  fetchSsh,
  isSource,
  listLocal,
  listSsh,
  localHistoryPath,
  localTranscriptsDir,
  parseListing,
  pullLocal,
  pullSsh,
  sourceKey,
} from "../src/main/sources";
import { isPlainHost, listSshHosts, parseSshConfig } from "../src/main/sshconfig";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibehours-test-"));
}

test("host names are read from an SSH config; patterns are not offered", () => {
  const parsed = parseSshConfig(
    [
      "# my boxes",
      "Host shed",
      "    HostName 10.0.0.5",
      "    User sam",
      "host=attic  loft",
      'Host "garage"',
      "Host *",
      "    ServerAliveInterval 30",
      "Host *.example.org !bastion web-?",
      "Include conf.d/*.conf",
    ].join("\r\n"),
  );
  assert.deepEqual(parsed.hosts, ["shed", "attic", "loft", "garage"]);
  assert.deepEqual(parsed.includes, ["conf.d/*.conf"]);
});

test("a name that could be read as an ssh option is never a host", () => {
  assert.equal(isPlainHost("-oProxyCommand=calc"), false);
  assert.equal(isPlainHost("shed; rm -rf"), false);
  assert.equal(isPlainHost("shed-2.lan"), true);
});

test("included config files are followed", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "conf.d"));
  fs.writeFileSync(path.join(dir, "config"), "Include conf.d/*.conf\nHost shed\n");
  fs.writeFileSync(path.join(dir, "conf.d", "a.conf"), "Host attic\n");
  fs.writeFileSync(path.join(dir, "conf.d", "b.conf"), "Host shed\nHost cellar\n");
  fs.writeFileSync(path.join(dir, "conf.d", "ignored.txt"), "Host nope\n");
  assert.deepEqual(listSshHosts(path.join(dir, "config")), ["shed", "attic", "cellar"]);
});

test("with nothing passed in, the SSH config is the one under this PC's own home, and ~ in an Include is that home", () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, ".ssh", "conf.d"), { recursive: true });
  fs.mkdirSync(path.join(home, "elsewhere"));
  fs.writeFileSync(path.join(home, ".ssh", "config"), "Host shed\nInclude conf.d/*.conf\nInclude ~/elsewhere/more\n");
  fs.writeFileSync(path.join(home, ".ssh", "conf.d", "a.conf"), "Host attic\n");
  fs.writeFileSync(path.join(home, "elsewhere", "more"), "Host cellar\n");
  const name = process.platform === "win32" ? "USERPROFILE" : "HOME";
  const before = process.env[name];
  process.env[name] = home;
  try {
    assert.deepEqual(listSshHosts(), ["shed", "attic", "cellar"]);
    assert.equal(localHistoryPath({}), path.join(home, ".claude", "history.jsonl"));
    assert.equal(localTranscriptsDir({}), path.join(home, ".claude", "projects"));
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
});

test("no SSH config means no hosts", () => {
  assert.deepEqual(listSshHosts(path.join(tempDir(), "config")), []);
});

test("the history is looked for in the home folder, or where CLAUDE_CONFIG_DIR says", () => {
  assert.equal(localHistoryPath({}, "/home/sam"), path.join("/home/sam", ".claude", "history.jsonl"));
  assert.equal(
    localHistoryPath({ CLAUDE_CONFIG_DIR: "/data/cc" }, "/home/sam"),
    path.join("/data/cc", "history.jsonl"),
  );
});

test("a missing history file is reported as not found, with where it looked", async () => {
  const file = path.join(tempDir(), "history.jsonl");
  const result = await fetchLocal(file);
  assert.deepEqual(result, { ok: false, reason: "not-found", detail: file });
});

test("a host that is not a plain name is refused before ssh runs", async () => {
  const result = await fetchSsh("-oProxyCommand=calc", "/no/such/program");
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "failed");
});

test("no ssh program is its own answer", async () => {
  const result = await fetchSsh("shed", path.join(tempDir(), "no-ssh-here"));
  assert.equal(!result.ok && result.reason, "program-missing");
});

const posix = { skip: process.platform === "win32" && "the stand-in ssh is a shell script" };

function standInProgram(body: string): string {
  const file = path.join(tempDir(), "stand-in");
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

test("ssh is run once in batch mode and its output is the history", posix, async () => {
  const ssh = standInProgram('echo "$@"');
  const result = await fetchSsh("shed", ssh);
  assert.ok(result.ok);
  assert.equal(result.text.trim(), "-o BatchMode=yes -o ConnectTimeout=10 shed cat ~/.claude/history.jsonl");
});

test("when ssh fails, the last line it said is passed back", posix, async () => {
  const ssh = standInProgram('echo "Warning: something minor" >&2\necho "sam@shed: Permission denied (publickey)." >&2\nexit 255');
  const result = await fetchSsh("shed", ssh);
  assert.deepEqual(result, { ok: false, reason: "failed", detail: "sam@shed: Permission denied (publickey)." });
});

test("a first run has no settings file, and takes its zone from the PC", () => {
  const { settings, firstRun } = loadSettings(tempDir());
  assert.equal(firstRun, true);
  assert.ok(isZone(settings.homeZone));
  assert.deepEqual(settings.sources, []);
});

test("settings survive a round trip", () => {
  const dir = tempDir();
  const saved = {
    version: 2 as const,
    homeZone: "Europe/London",
    sources: [{ kind: "local" as const }, { kind: "ssh" as const, host: "shed" }],
    keepYearAnswer: "no" as const,
  };
  saveSettings(dir, saved);
  assert.deepEqual(loadSettings(dir), { settings: saved, firstRun: false });
});

test("a settings file written by v0.1.0 still loads: one source becomes a list of one", () => {
  for (const [source, expected] of [
    [{ kind: "ssh", host: "shed" }, [{ kind: "ssh", host: "shed" }]],
    [{ kind: "local" }, [{ kind: "local" }]],
  ] as const) {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ homeZone: "Europe/London", source }, null, 2));
    const { settings, firstRun } = loadSettings(dir);
    assert.equal(firstRun, false);
    assert.deepEqual(settings, { version: 2, homeZone: "Europe/London", sources: expected });
  }
});

test("saved sources that are not sources, or are there twice, are left out", () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({
      version: 2,
      homeZone: "Europe/London",
      // A WSL source saved by v0.2.0 is one of the things no longer read.
      sources: [{ kind: "ssh", host: "shed" }, { kind: "ssh", host: "-oProxyCommand=calc" }, { kind: "ssh", host: "shed" }, "junk", { kind: "ftp" }, { kind: "wsl", distro: "Ubuntu" }],
    }),
  );
  assert.deepEqual(loadSettings(dir).settings.sources, [{ kind: "ssh", host: "shed" }]);
});

test("a settings file that cannot be read is a first run, not a crash", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "settings.json"), "{half a file");
  assert.equal(loadSettings(dir).firstRun, true);
});

test("each source has its own key", () => {
  assert.equal(sourceKey({ kind: "local" }), "local");
  assert.equal(sourceKey({ kind: "ssh", host: "local" }), "ssh:local");
  assert.equal(isSource({ kind: "ssh", host: "shed" }), true);
  assert.equal(isSource({ kind: "wsl", distro: "Ubuntu" }), false);
});

function fakeHome(files: Record<string, string>): string {
  const home = tempDir();
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(home, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return home;
}

/** An `ssh` that runs what it is asked on this box, with a made-up home. */
function standInBox(home: string): string {
  return standInProgram(`for last; do :; done\nHOME='${home}' exec sh -c "$last"`);
}

const A_REPLY = JSON.stringify({ type: "assistant", timestamp: "2026-03-02T10:00:00Z", message: { id: "msg-1" } });
const A_PROMPT = JSON.stringify({ type: "user", message: { content: "made-up words with spaces" } });
const TRANSCRIPTS = {
  ".claude/projects/-made-up/aaa.jsonl": `${A_PROMPT}\n${A_REPLY}\n${JSON.stringify({ type: "cost-state", sessionId: "s" })}\n`,
  ".claude/projects/-made-up/aaa/subagents/agent-1.jsonl": `${A_REPLY}\n`,
  ".claude/projects/-with space/bbb.jsonl": `${A_PROMPT}\n`,
  ".claude/projects/-made-up/notes.txt": "not a transcript\n",
};

function sizeOf(home: string, rel: string): number {
  return fs.statSync(path.join(home, ".claude", "projects", ...rel.split("/"))).size;
}

test("transcripts on this PC are listed with their sizes, sub-agents' too", async () => {
  const home = fakeHome(TRANSCRIPTS);
  const listed = await listLocal(localTranscriptsDir({}, home));
  assert.ok(listed.ok);
  assert.deepEqual(
    listed.files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    ["-made-up/aaa.jsonl", "-made-up/aaa/subagents/agent-1.jsonl", "-with space/bbb.jsonl"].map((p) => ({ path: p, size: sizeOf(home, p) })),
  );
});

test("a PC with no projects folder has no transcripts, which is not a failure", async () => {
  assert.deepEqual(await listLocal(path.join(tempDir(), "projects")), { ok: true, files: [], keepsLonger: null });
});

test("only the three kinds of line are handed on from a file on this PC", async () => {
  const home = fakeHome(TRANSCRIPTS);
  const got: [string, string][] = [];
  const pulled = await pullLocal(["-made-up/aaa.jsonl", "-with space/bbb.jsonl", "-made-up/gone.jsonl"], (p, l) => got.push([p, JSON.parse(l).type]), localTranscriptsDir({}, home));
  assert.deepEqual(pulled, { ok: true });
  assert.deepEqual(got, [
    ["-made-up/aaa.jsonl", "assistant"],
    ["-made-up/aaa.jsonl", "cost-state"],
  ]);
});

test("what is run on another box holds no double quote and changes nothing there", () => {
  for (const command of Object.values(REMOTE_COMMANDS)) {
    assert.doesNotMatch(command, /"/);
    assert.doesNotMatch(command, /\b(rm|mv|cp|tee|touch|mkdir|chmod|python|node)\b|>(?!\/dev\/null)/);
  }
});

test("a listing is a size and a path per line, and is refused if it was cut short", () => {
  const whole = '"cleanupPeriodDays": 365\nvibehours-files\n  120 ./-made-up/aaa.jsonl\n   40 ./-with space/bbb.jsonl\n  160 total\nvibehours-listed\n';
  assert.deepEqual(parseListing(whole), {
    ok: true,
    files: [
      { path: "-made-up/aaa.jsonl", size: 120 },
      { path: "-with space/bbb.jsonl", size: 40 },
    ],
    keepsLonger: true,
  });
  assert.deepEqual(parseListing("vibehours-files\nvibehours-listed\n"), { ok: true, files: [], keepsLonger: false });
  const cut = parseListing("vibehours-files\n  120 ./-made-up/aaa.jsonl\n");
  assert.equal(!cut.ok && cut.detail, "The list of transcripts was cut short.");
});

test("another box is asked for its transcripts' sizes and for the one settings key", posix, async () => {
  const home = fakeHome({
    ...TRANSCRIPTS,
    ".claude/settings.json": '{\n  "apiKeyHelper": "made-up-secret",\n  "cleanupPeriodDays": 365,\n  "model": "x"\n}\n',
  });
  const listed = await listSsh("shed", standInBox(home));
  assert.ok(listed.ok);
  assert.equal(listed.keepsLonger, true);
  assert.deepEqual(
    listed.files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    ["-made-up/aaa.jsonl", "-made-up/aaa/subagents/agent-1.jsonl", "-with space/bbb.jsonl"].map((p) => ({ path: p, size: sizeOf(home, p) })),
  );

  const without = fakeHome({ ".claude/settings.json": '{ "model": "x" }\n' });
  assert.deepEqual(await listSsh("shed", standInBox(without)), { ok: true, files: [], keepsLonger: false });
  // No Claude Code there at all.
  assert.deepEqual(await listSsh("shed", standInBox(tempDir())), { ok: true, files: [], keepsLonger: false });
});

test("only the settings key and its value leave the other box, never the rest of the file", posix, async () => {
  const home = fakeHome({ ".claude/settings.json": '{"apiKeyHelper":"made-up-secret","cleanupPeriodDays":90,"env":{"TOKEN":"made-up-token"}}' });
  const out = await new Promise<string>((resolve) => {
    execFile(standInBox(home), ["shed", REMOTE_COMMANDS.list], (_err, stdout) => resolve(stdout));
  });
  assert.equal(out, '"cleanupPeriodDays":90\nvibehours-files\nvibehours-listed\n');
});

test("another box filters its transcripts to the lines wanted, compresses them, and each line comes back with its file", posix, async () => {
  const home = fakeHome(TRANSCRIPTS);
  const got: [string, string][] = [];
  const pulled = await pullSsh(
    "shed",
    ["-made-up/aaa.jsonl", "-made-up/aaa/subagents/agent-1.jsonl", "-with space/bbb.jsonl"],
    (p, l) => got.push([p, JSON.parse(l).type]),
    standInBox(home),
  );
  assert.deepEqual(pulled, { ok: true });
  assert.deepEqual(got.sort(), [
    ["-made-up/aaa.jsonl", "assistant"],
    ["-made-up/aaa.jsonl", "cost-state"],
    ["-made-up/aaa/subagents/agent-1.jsonl", "assistant"],
  ]);
});

test("when the other box cannot be reached for its transcripts, the last line ssh said is passed back", posix, async () => {
  const ssh = standInProgram('echo "ssh: connect to host shed port 22: Connection refused" >&2\nexit 255');
  assert.deepEqual(await pullSsh("shed", ["-made-up/aaa.jsonl"], () => assert.fail("no line"), ssh), {
    ok: false,
    reason: "failed",
    detail: "ssh: connect to host shed port 22: Connection refused",
  });
  const missing = await pullSsh("shed", ["a.jsonl"], () => undefined, path.join(tempDir(), "no-ssh-here"));
  assert.equal(!missing.ok && missing.reason, "program-missing");
  const odd = await pullSsh("shed", ["a\nb.jsonl"], () => undefined, ssh);
  assert.equal(!odd.ok && odd.reason, "failed");
});

test("a box with no history is nothing found, not a failure", posix, async () => {
  const ssh = standInProgram('echo "cat: /home/sam/.claude/history.jsonl: No such file or directory" >&2\nexit 1');
  assert.deepEqual(await fetchSsh("shed", ssh), { ok: false, reason: "not-found", detail: "~/.claude/history.jsonl on shed" });
});

test("a zone that does not exist is not a zone", () => {
  assert.equal(isZone("Mars/Olympus"), false);
  assert.equal(isZone(""), false);
  assert.equal(isZone("Pacific/Auckland"), true);
});
