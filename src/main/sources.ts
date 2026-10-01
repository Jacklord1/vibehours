// Where Claude Code's files are read from: this PC, or another box over SSH.
// No Electron import, so all of it runs under the test runner.
//
// On another box nothing is run but `cat`, `find`, `wc`, `grep`, `xargs` and
// `gzip`, which every Linux and macOS box has, and nothing is changed there.

import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import * as zlib from "node:zlib";
import { WANTED_LINES, isWanted } from "../engine/transcripts";
import { isPlainHost } from "./sshconfig";

export type Source = { kind: "local" } | { kind: "ssh"; host: string };

export type Failure = {
  ok: false;
  reason: "not-found" | "failed" | "program-missing" | "unreadable" | "changed";
  detail: string;
};

export type Fetched = { ok: true; text: string } | Failure;

export interface Listing {
  ok: true;
  /** Transcript files, by path under the `projects` folder, with `/`. */
  files: { path: string; size: number }[];
  /**
   * Whether the box already keeps its transcripts longer than the default.
   * Null when that was not looked at.
   */
  keepsLonger: boolean | null;
}

export type Listed = Listing | Failure;
export type Pulled = { ok: true } | Failure;

/** Reads a source. The app has one; tests stand in their own. */
export interface Reader {
  history(source: Source): Promise<Fetched>;
  list(source: Source): Promise<Listed>;
  /** Hands over the wanted lines of each file, in memory, one at a time. */
  pull(source: Source, paths: string[], onLine: (path: string, line: string) => void): Promise<Pulled>;
}

export function isSource(s: unknown): s is Source {
  const v = s as { kind?: unknown; host?: unknown } | null;
  if (!v || typeof v !== "object") return false;
  if (v.kind === "local") return true;
  if (v.kind === "ssh") return typeof v.host === "string" && isPlainHost(v.host);
  return false;
}

/** One string per source, for telling them apart. */
export function sourceKey(s: Source): string {
  return s.kind === "ssh" ? `ssh:${s.host}` : "local";
}

/** A copy holding only the fields a source has. */
export function cleanSource(s: Source): Source {
  return s.kind === "ssh" ? { kind: "ssh", host: s.host } : { kind: "local" };
}

/**
 * Claude Code keeps its files in `~/.claude`, which on Windows is
 * `%USERPROFILE%\.claude`. `CLAUDE_CONFIG_DIR` moves the whole folder.
 */
export function claudeDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
}

export function localHistoryPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(claudeDir(env, home), "history.jsonl");
}

export function localTranscriptsDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(claudeDir(env, home), "projects");
}

export async function fetchLocal(file = localHistoryPath()): Promise<Fetched> {
  try {
    return { ok: true, text: await fs.promises.readFile(file, "utf8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reason: "not-found", detail: file };
    return { ok: false, reason: "unreadable", detail: `${file} (${code ?? "read failed"})` };
  }
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  return lines.length ? lines[lines.length - 1] : "";
}

const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];

// What is run on the other box. No double quote in any of them, so nothing
// depends on how a quote crosses a Windows command line.
const REMOTE_HISTORY = "cat ~/.claude/history.jsonl";
// The one settings key and its value, never the file, which can hold
// secrets. Then every transcript with its size, and a line to show the
// listing ran to its end.
const REMOTE_LIST =
  "grep -o '.cleanupPeriodDays.[^,}]*' ~/.claude/settings.json 2>/dev/null; echo vibehours-files; " +
  "cd ~/.claude/projects 2>/dev/null && find . -type f -name '*.jsonl' -exec wc -c {} +; echo vibehours-listed";
// The paths wanted arrive on stdin, each ended by a zero byte. Only the
// lines wanted leave the box, compressed, each with its file's path in front.
const REMOTE_PULL = `cd ~/.claude/projects && xargs -0 grep -HE '${WANTED_LINES}' | gzip -c`;

export const REMOTE_COMMANDS = { history: REMOTE_HISTORY, list: REMOTE_LIST, pull: REMOTE_PULL };

// Runs one program once and hands back what it printed. No retry.
function runOnce(program: string, args: string[], timeout = 120_000): Promise<Fetched> {
  return new Promise((resolve) => {
    execFile(
      program,
      args,
      { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, text: stdout.toString("utf8") });
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return resolve({ ok: false, reason: "program-missing", detail: program });
        }
        if (err.killed) return resolve({ ok: false, reason: "failed", detail: "No answer after two minutes." });
        const said = lastLine(stderr.toString("utf8")) || lastLine(stdout.toString("utf8").slice(-2000));
        resolve({ ok: false, reason: "failed", detail: said || "It stopped without saying why." });
      },
    );
  });
}

const NOT_A_HOST: Failure = { ok: false, reason: "failed", detail: "Not a host name from the SSH config." };

/**
 * Runs the system `ssh` once. BatchMode means it can never stop to ask for a
 * password; if the login the PC already has does not work, it fails and the
 * last line of what ssh said is passed back.
 */
export async function fetchSsh(host: string, sshProgram = "ssh"): Promise<Fetched> {
  if (!isPlainHost(host)) return NOT_A_HOST;
  const got = await runOnce(sshProgram, [...SSH_OPTIONS, host, REMOTE_HISTORY]);
  // The box answered and has no history: nothing found, not a failure.
  if (!got.ok && got.reason === "failed" && /No such file or directory/.test(got.detail)) {
    return { ok: false, reason: "not-found", detail: `~/.claude/history.jsonl on ${host}` };
  }
  return got;
}

/** What `find … -exec wc -c` printed: a size and a path per line. */
export function parseListing(text: string): Listed {
  const [before, after] = text.split(/^vibehours-files\r?$/m);
  if (after === undefined || !/^vibehours-listed\r?$/m.test(after)) {
    return { ok: false, reason: "failed", detail: "The list of transcripts was cut short." };
  }
  const files: { path: string; size: number }[] = [];
  for (const line of after.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+\.\/(.+\.jsonl)$/.exec(line);
    if (m) files.push({ path: m[2], size: Number(m[1]) });
  }
  return { ok: true, files, keepsLonger: /cleanupPeriodDays/.test(before) };
}

export async function listSsh(host: string, sshProgram = "ssh"): Promise<Listed> {
  if (!isPlainHost(host)) return NOT_A_HOST;
  const got = await runOnce(sshProgram, [...SSH_OPTIONS, host, REMOTE_LIST]);
  return got.ok ? parseListing(got.text) : got;
}

export function pullSsh(
  host: string,
  paths: string[],
  onLine: (path: string, line: string) => void,
  sshProgram = "ssh",
): Promise<Pulled> {
  if (!isPlainHost(host)) return Promise.resolve(NOT_A_HOST);
  if (paths.some((p) => /[\0\r\n]/.test(p))) {
    return Promise.resolve({ ok: false, reason: "failed", detail: "A transcript has a name that cannot be asked for." });
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: Pulled) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(sshProgram, [...SSH_OPTIONS, host, REMOTE_PULL], { windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, reason: "failed", detail: "No answer after fifteen minutes." });
    }, 15 * 60_000);

    let said = "";
    child.stderr.on("data", (chunk: Buffer) => {
      said = (said + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (err) => {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      finish({ ok: false, reason: missing ? "program-missing" : "failed", detail: missing ? sshProgram : err.message });
    });

    // Nothing that arrives is written to disk: it is unpacked and read a
    // line at a time, in memory.
    const unpacked = child.stdout.pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input: unpacked, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const cut = line.indexOf(".jsonl:{");
      if (line.startsWith("./") && cut > 0) onLine(line.slice(2, cut + 6), line.slice(cut + 7));
    });
    // The answer waits for both ends: what ssh said on the way out is the
    // better reason when the stream it sent could not be unpacked.
    let exit: number | null | undefined;
    let ended = false;
    let broken = false;
    const settle = () => {
      if (exit === undefined || !ended) return;
      if (exit !== 0) finish({ ok: false, reason: "failed", detail: lastLine(said) || "It stopped without saying why." });
      else if (broken) finish({ ok: false, reason: "failed", detail: "What came back could not be unpacked." });
      else finish({ ok: true });
    };
    const end = () => {
      ended = true;
      settle();
    };
    unpacked.on("error", () => {
      broken = true;
      end();
    });
    lines.on("error", () => undefined);
    lines.on("close", end);
    child.on("close", (code) => {
      exit = code;
      settle();
    });

    child.stdin.on("error", () => undefined);
    child.stdin.end(paths.map((p) => `./${p}\0`).join(""));
  });
}

/** Every transcript under the folder, with its size. No folder is no files. */
export async function listLocal(dir = localTranscriptsDir()): Promise<Listed> {
  const files: { path: string; size: number }[] = [];
  const walk = async (folder: string, prefix: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch (err) {
      if (prefix === "" && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          files.push({ path: prefix + entry.name, size: (await fs.promises.stat(full)).size });
        } catch {
          // Gone between the listing and the look: Claude Code tidies up.
        }
      }
    }
  };
  try {
    await walk(dir, "");
  } catch (err) {
    return { ok: false, reason: "unreadable", detail: `${dir} (${(err as NodeJS.ErrnoException).code ?? "read failed"})` };
  }
  return { ok: true, files, keepsLonger: null };
}

export async function pullLocal(
  paths: string[],
  onLine: (path: string, line: string) => void,
  dir = localTranscriptsDir(),
): Promise<Pulled> {
  for (const p of paths) {
    try {
      const input = fs.createReadStream(path.join(dir, ...p.split("/")), "utf8");
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      // The same test the other box runs, so every source hands on the same lines.
      for await (const line of lines) if (isWanted(line)) onLine(p, line);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // A transcript deleted since the listing is simply not read.
      if (code !== "ENOENT") return { ok: false, reason: "unreadable", detail: `${p} (${code ?? "read failed"})` };
    }
  }
  return { ok: true };
}

export const systemReader: Reader = {
  history: (source) => (source.kind === "ssh" ? fetchSsh(source.host) : fetchLocal()),
  list: (source) => (source.kind === "ssh" ? listSsh(source.host) : listLocal()),
  pull: (source, paths, onLine) =>
    source.kind === "ssh" ? pullSsh(source.host, paths, onLine) : pullLocal(paths, onLine),
};
