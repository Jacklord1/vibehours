// Made-up sources, histories and transcripts only.
//
// A PC can have transcripts and no prompt history: the Claude desktop app's
// Code sessions write no `history.jsonl`. These tests cover what is then a
// typed prompt, which ledger a session is counted from, and every sentence
// the app says about what a source holds.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import { idHash } from "../src/engine/hours";
import { ENTRYPOINTS, TranscriptFile, WANTED_LINES, applyFiles, isUnattended, isWanted, typedRows } from "../src/engine/transcripts";
import { Session, type SourceStatus } from "../src/main/session";
import type { Fetched, Listed, Reader, Source } from "../src/main/sources";
import { emptyStore, loadStore, type Store } from "../src/main/store";
import { queued, reply, toolResult, typed } from "./made-up";

const DESK: Source = { kind: "local" };
const SHED: Source = { kind: "ssh", host: "shed" };
const NOW = Date.parse("2026-03-02T12:00:00Z");
const at = (iso: string) => Date.parse(iso);

function fileOf(path: string, lines: string[]): TranscriptFile {
  const file = new TranscriptFile(path, lines.join("\n").length);
  for (const line of lines) if (isWanted(line)) file.feed(line);
  return file;
}

// ------------------------------------------------- what a typed prompt is

test("a prompt a person typed gives its time, and nothing else is kept of it", () => {
  const file = fileOf("p/a.jsonl", [typed({ at: "2026-03-02T10:00:00Z" }), reply({ at: "2026-03-02T10:00:05Z", id: "m1" }), typed({ at: "2026-03-02T10:20:00Z" })]);
  assert.deepEqual(file.typed, [at("2026-03-02T10:00:00Z"), at("2026-03-02T10:20:00Z")]);
  const kept = applyFiles({}, [file], "UTC").files["p/a.jsonl"];
  assert.deepEqual(kept.typed, file.typed);
  assert.doesNotMatch(JSON.stringify(kept) + JSON.stringify(file), /never be kept/);
  // A typed line is not one of the three kinds counted for "has Claude Code changed".
  assert.equal(file.lines, 1);
  assert.equal(file.bad, 0);
  // And it does not stretch the session's own times: those are the model's lines.
  assert.deepEqual(kept.runs, [[at("2026-03-02T10:00:05Z"), at("2026-03-02T10:00:05Z")]]);
});

test("the desktop app's prompts are a person typing: sent through the SDK, as words, a picture or both", () => {
  const file = fileOf("p/a.jsonl", [
    typed({ at: "2026-03-02T10:00:00Z", entrypoint: "claude-desktop", source: "sdk" }),
    typed({ at: "2026-03-02T10:05:00Z", entrypoint: "claude-desktop", source: "sdk", picture: true }),
    // What the desktop app writes into the conversation itself.
    typed({ at: "2026-03-02T10:06:00Z", entrypoint: "claude-desktop", origin: null, meta: true }),
    typed({ at: "2026-03-02T10:07:00Z", entrypoint: "claude-desktop", origin: null }),
  ]);
  assert.deepEqual(file.typed, [at("2026-03-02T10:00:00Z"), at("2026-03-02T10:05:00Z")]);
  assert.doesNotMatch(JSON.stringify(file), /never be kept|bWFkZS11cA/);
});

test("a tool result, a line Claude Code wrote itself, a sub-agent's prompt and a notification are not a person typing", () => {
  const file = fileOf("p/a.jsonl", [
    toolResult("2026-03-02T10:00:00Z"),
    typed({ at: "2026-03-02T10:01:00Z", meta: true }),
    typed({ at: "2026-03-02T10:02:00Z", origin: null }),
    typed({ at: "2026-03-02T10:03:00Z", origin: "task-notification" }),
    typed({ at: "2026-03-02T10:04:00Z", origin: "auto-continuation", meta: true }),
    typed({ at: "2026-03-02T10:05:00Z", sidechain: true }),
    queued("2026-03-02T10:06:00Z", "2026-03-02T10:07:00Z", "session-a", "task-notification"),
    reply({ at: "2026-03-02T10:08:00Z", id: "m1" }),
  ]);
  assert.deepEqual(file.typed, []);
  // A tool result whose own fields hold the marker reaches the reader and is still not counted.
  const quoting = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] }, toolUseResult: { origin: { kind: "human" } }, origin: { kind: "human" }, timestamp: "2026-03-02T10:09:00Z" });
  assert.equal(isWanted(quoting), true);
  assert.deepEqual(fileOf("p/b.jsonl", [quoting]).typed, []);
});

test("a prompt typed while the agent was busy is counted at the time it was typed", () => {
  const file = fileOf("p/a.jsonl", [queued("2026-03-02T10:06:00Z", "2026-03-02T10:09:30Z")]);
  assert.deepEqual(file.typed, [at("2026-03-02T10:06:00Z")]);
  assert.equal(file.session, "session-a");
});

test("a headless run's prompt is not a person typing, and every entry point known is listed with where it was seen", () => {
  const file = fileOf("p/a.jsonl", [typed({ at: "2026-03-02T10:00:00Z", entrypoint: "sdk-cli" }), typed({ at: "2026-03-02T10:01:00Z", entrypoint: "sdk-cli", origin: null })]);
  assert.deepEqual(file.typed, []);
  assert.equal(isUnattended("sdk-cli"), true);
  assert.equal(isUnattended("cli"), false);
  assert.equal(isUnattended("claude-desktop"), false);
  // One not seen before is attended until the facts say otherwise.
  assert.equal(isUnattended("something-new"), false);
  assert.equal(isUnattended(undefined), false);
  for (const [name, seen] of Object.entries(ENTRYPOINTS)) assert.ok(seen.seen.length > 10, name);
  assert.deepEqual(Object.entries(ENTRYPOINTS).filter(([, e]) => !e.attended).map(([name]) => name), ["sdk-cli"]);
});

test("a sub-agent's file gives no typed prompts", () => {
  const file = fileOf("p/a/subagents/agent-1.jsonl", [typed({ at: "2026-03-02T10:00:00Z" })]);
  assert.deepEqual(applyFiles({}, [file], "UTC").files["p/a/subagents/agent-1.jsonl"].typed, []);
});

// ------------------------------------------------------ one ledger or the other

test("a session the prompt history holds is left to it; one it does not is counted from its transcript", () => {
  const files = applyFiles(
    {},
    [
      fileOf("p/a.jsonl", [typed({ at: "2026-03-02T10:00:00Z", session: "in-history" }), typed({ at: "2026-03-02T10:10:00Z", session: "in-history" })]),
      fileOf("p/b.jsonl", [typed({ at: "2026-03-02T11:00:00Z", session: "desktop" }), queued("2026-03-02T11:05:00Z", "2026-03-02T11:06:00Z", "desktop")]),
    ],
    "UTC",
  ).files;
  const rows = typedRows([files], new Set([idHash("in-history")]));
  assert.deepEqual(rows.map((r) => r.t), [at("2026-03-02T11:00:00Z"), at("2026-03-02T11:05:00Z")]);
  assert.equal(rows[0].folder, "/made/up/project");
  assert.equal(rows[0].text, undefined);
  assert.equal(typedRows([files], new Set()).length, 4);
  // One box ticked under two names holds the same files: each prompt once.
  assert.equal(typedRows([files, files], new Set()).length, 4);
});

test("a session written across two files gives each typed time once", () => {
  const lines = [typed({ at: "2026-03-02T10:00:00Z", session: "resumed" })];
  const files = applyFiles({}, [fileOf("p/a.jsonl", lines), fileOf("p/b.jsonl", [...lines, typed({ at: "2026-03-02T10:30:00Z", session: "resumed" })])], "UTC").files;
  assert.deepEqual(typedRows([files], new Set()).map((r) => r.t), [at("2026-03-02T10:00:00Z"), at("2026-03-02T10:30:00Z")]);
});

// --------------------------------------------------------------- whole sources

interface Box {
  history: Fetched;
  files?: Record<string, string[]>;
  list?: Listed;
}

const NOT_FOUND: Fetched = { ok: false, reason: "not-found", detail: "/made/up/.claude/history.jsonl" };

function historyRow(iso: string, display: string, session: string): string {
  return JSON.stringify({ display, timestamp: Date.parse(iso), project: "/made/up/project", sessionId: session });
}

function world(boxes: Record<string, Box>, store: Store = emptyStore("UTC")) {
  const nameOf = (source: Source) => (source.kind === "ssh" ? source.host : source.kind);
  const reader: Reader = {
    history: async (source) => boxes[nameOf(source)].history,
    async list(source) {
      const box = boxes[nameOf(source)];
      if (box.list) return box.list;
      return { ok: true, files: Object.entries(box.files ?? {}).map(([path, lines]) => ({ path, size: lines.join("\n").length })), keepsLonger: null };
    },
    async pull(source, paths, onLine) {
      for (const path of paths) for (const l of boxes[nameOf(source)].files?.[path] ?? []) if (isWanted(l)) onLine(path, l);
      return { ok: true };
    },
  };
  return { session: new Session(store, reader), store, boxes };
}

/** A desktop-app session: prompts at 10:00, 10:20 and 10:40, replies after each. */
const DESKTOP_SESSION = [
  typed({ at: "2026-03-02T10:00:00Z", session: "desktop" }),
  reply({ at: "2026-03-02T10:00:30Z", id: "m1", session: "desktop" }),
  toolResult("2026-03-02T10:00:40Z", "desktop"),
  typed({ at: "2026-03-02T10:20:00Z", session: "desktop" }),
  reply({ at: "2026-03-02T10:21:00Z", id: "m2", session: "desktop" }),
  queued("2026-03-02T10:40:00Z", "2026-03-02T10:41:00Z", "desktop"),
  reply({ at: "2026-03-02T10:45:00Z", id: "m3", session: "desktop" }),
];

test("a PC with transcripts and no prompt history has prompting hours, counted from its typed lines", async () => {
  const { session, store } = world({ local: { history: NOT_FOUND, files: { "p/desktop.jsonl": DESKTOP_SESSION } } });
  await session.read(DESK);
  const numbers = session.numbers([DESK], "UTC", NOW);
  assert.equal(numbers.fromTranscripts, 3);
  assert.equal(numbers.report?.headline?.prompts, 3);
  assert.equal(numbers.report?.headline?.activeDays, 1);
  // One block, 10:00 to 10:40, and ten minutes past its last prompt.
  assert.ok(Math.abs((numbers.report?.headline?.totalHours ?? 0) - 50 / 60) < 1e-9);
  assert.ok(numbers.usage);
  // The page that needs prompt rows gets them, with a folder and no text.
  assert.equal(numbers.screens.prompts?.count, 3);
  assert.equal(numbers.screens.words, null);
  assert.doesNotMatch(JSON.stringify(store) + JSON.stringify(numbers), /never be kept/);

  // Opened again: the numbers come from the store before anything is read.
  const again = new Session(JSON.parse(JSON.stringify(store)) as Store).numbers([DESK], "UTC", NOW);
  assert.equal(again.report?.headline?.prompts, 3);
});

test("a session in the prompt history and in the transcripts is counted once, from the history", async () => {
  const history = [historyRow("2026-03-02T10:00:00Z", "one", "terminal"), historyRow("2026-03-02T10:20:02Z", "two", "terminal")].join("\n");
  const terminal = [typed({ at: "2026-03-02T10:00:01Z", session: "terminal" }), reply({ at: "2026-03-02T10:00:30Z", id: "t1", session: "terminal" }), typed({ at: "2026-03-02T10:20:03Z", session: "terminal" })];
  const { session } = world({ local: { history: { ok: true, text: history }, files: { "p/terminal.jsonl": terminal, "p/desktop.jsonl": DESKTOP_SESSION.map((l) => l.replaceAll("2026-03-02T10", "2026-03-02T14")) } } });
  await session.read(DESK);
  const numbers = session.numbers([DESK], "UTC", NOW);
  // Two from the history, three from the session it does not hold. The terminal's two typed lines are not added.
  assert.equal(numbers.report?.headline?.prompts, 5);
  assert.equal(numbers.fromTranscripts, 3);
  assert.equal(numbers.report?.days[0].blocks, 2);
});

test("a session whose only history rows are housekeeping is still the history's", async () => {
  const history = [historyRow("2026-03-02T10:00:00Z", "/exit", "terminal")].join("\n");
  const { session } = world({ local: { history: { ok: true, text: history }, files: { "p/terminal.jsonl": [typed({ at: "2026-03-02T09:59:00Z", session: "terminal" }), reply({ at: "2026-03-02T09:59:30Z", id: "t1", session: "terminal" })] } } });
  await session.read(DESK);
  assert.equal(session.numbers([DESK], "UTC", NOW).fromTranscripts, 0);
});

test("an unattended session is not counted as typing", async () => {
  const headless = [typed({ at: "2026-03-02T10:00:00Z", session: "headless", entrypoint: "sdk-cli", origin: null }), reply({ at: "2026-03-02T10:00:30Z", id: "h1", session: "headless", entrypoint: "sdk-cli" })];
  const { session } = world({ local: { history: NOT_FOUND, files: { "p/headless.jsonl": headless } } });
  await session.read(DESK);
  const numbers = session.numbers([DESK], "UTC", NOW);
  assert.equal(numbers.fromTranscripts, 0);
  assert.equal(numbers.report, null);
  assert.equal(numbers.usage?.unattended.runs, 1);
});

test("a history kept by an older version gives no typed lines until it is read again", () => {
  const store = emptyStore("UTC");
  const files = applyFiles({}, [fileOf("p/a.jsonl", [typed({ at: "2026-03-02T10:00:01Z", session: "terminal" })])], "UTC").files;
  // As version 2 left it: the prompts, and no list of their sessions.
  store.sources.local = { files, prompts: { readAt: NOW, rows: [[at("2026-03-02T10:00:00Z"), "h", -1]], folders: [], dropped: 0, badLines: 0 } };
  const numbers = new Session(store).numbers([DESK], "UTC", NOW);
  assert.equal(numbers.fromTranscripts, 0);
  assert.equal(numbers.report?.headline?.prompts, 1);
});

// ------------------------------------------------ what the app says of a source

interface Words {
  sourceCase(s: SourceStatus): string;
  isCounted(s: SourceStatus): boolean;
  statusText(s: SourceStatus, f: unknown): { text: string; bad: boolean };
  failureText(s: SourceStatus, f: unknown): string;
  staleText(s: SourceStatus, name: string, f: unknown): string;
  noNumbersText(sources: SourceStatus[], named: (s: SourceStatus) => string, f: unknown): { line: string; detail: string[] };
}

// The page's own script, run as the page runs it.
function words(): Words {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(process.cwd(), "dist", "src", "renderer", "words.js"), "utf8"), context);
  const page = context as unknown as Words;
  // What the script hands back is copied into this side's own objects, to be compared.
  return {
    sourceCase: (s) => page.sourceCase(s),
    isCounted: (s) => page.isCounted(s),
    failureText: (s, f) => page.failureText(s, f),
    statusText: (s, f) => ({ ...page.statusText(s, f) }),
    staleText: (s, name, f) => page.staleText(s, name, f),
    noNumbersText: (sources, named, f) => {
      const said = page.noNumbersText(sources, named, f);
      return { line: said.line, detail: [...said.detail] };
    },
  };
}

const FORMATS = { when: () => "1 Mar at 9:00 am", time: () => "noon", day: () => "2 Mar 2026", count: (n: number) => String(n), hideNames: false, windows: true };

async function statusOf(box: Box, before?: Box): Promise<SourceStatus> {
  const w = world({ local: before ?? box });
  if (before) {
    await w.session.read(DESK);
    w.boxes.local = box;
  }
  await w.session.read(DESK);
  return w.session.status(DESK);
}

const HISTORY: Fetched = { ok: true, text: [historyRow("2026-03-02T10:00:00Z", "one", "terminal"), historyRow("2026-03-02T10:20:00Z", "two", "terminal")].join("\n") };
const TERMINAL = { "p/terminal.jsonl": [reply({ at: "2026-03-02T10:00:30Z", id: "t1", session: "terminal" })] };

test("found with both: prompts and transcripts, and no warning", async () => {
  const s = await statusOf({ history: HISTORY, files: TERMINAL });
  const w = words();
  assert.equal(w.sourceCase(s), "both");
  assert.deepEqual(w.statusText(s, FORMATS), { text: "2 prompts, the first on 2 Mar 2026. 1 transcript. Read at noon.", bad: false });
  assert.equal(w.isCounted(s), true);
});

test("found with transcripts only: said plainly, not in red, and never as not found or not read", async () => {
  const s = await statusOf({ history: NOT_FOUND, files: { "p/desktop.jsonl": DESKTOP_SESSION } });
  const w = words();
  assert.equal(w.sourceCase(s), "transcripts-only");
  const said = w.statusText(s, FORMATS);
  assert.deepEqual(said, { text: "1 transcript, and no terminal prompt history. The times you typed are taken from the transcripts. Read at noon.", bad: false });
  assert.doesNotMatch(said.text, /found|could not/);
  // It is among the sources counted, so the Overview names it and does not say it could not be read.
  assert.equal(w.isCounted(s), true);
});

test("found with history only: prompts, and the plain fact that there are no transcripts", async () => {
  const s = await statusOf({ history: HISTORY });
  const w = words();
  assert.equal(w.sourceCase(s), "history-only");
  assert.deepEqual(w.statusText(s, FORMATS), { text: "2 prompts, the first on 2 Mar 2026. No transcripts, so no tokens or session hours come from here. Read at noon.", bad: false });
});

test("nothing there: says what was looked for, and is not a warning", async () => {
  const s = await statusOf({ history: NOT_FOUND });
  const w = words();
  assert.equal(w.sourceCase(s), "nothing");
  assert.deepEqual(w.statusText(s, FORMATS), {
    text: "No Claude Code prompt history or transcripts were found. Looked for /made/up/.claude/history.jsonl and for transcripts beside it.",
    bad: false,
  });
  assert.equal(w.isCounted(s), false);
  // With names hidden the path is not written out.
  assert.equal(w.statusText(s, { ...FORMATS, hideNames: true }).text, "No Claude Code prompt history or transcripts were found.");
  // With no other source the Overview says nothing was found. It does not say the source could not be read: it was.
  const said = w.noNumbersText([s], () => "This PC", FORMATS);
  assert.equal(said.line, "No Claude Code prompt history or transcripts were found, so there is nothing to count yet.");
  assert.doesNotMatch(said.line + said.detail.join(" "), /could not be read/);
});

test("used to read and now fails: a warning, with why, and that the numbers are from before", async () => {
  const w = words();
  const unreachable: Box = { history: { ok: false, reason: "failed", detail: "ssh: connect to host shed port 22: Connection timed out" } };
  const s = await statusOf(unreachable, { history: HISTORY, files: TERMINAL });
  assert.equal(w.sourceCase(s), "failing");
  assert.deepEqual(w.statusText(s, FORMATS), {
    text: "Could not be read. ssh said: connect to host shed port 22: Connection timed out. Its numbers are the ones read at 1 Mar at 9:00 am.",
    bad: true,
  });
  assert.equal(w.isCounted(s), true);
  assert.equal(
    w.staleText(s, "Shed", FORMATS),
    "Shed could not be read just now, so its numbers are the ones read at 1 Mar at 9:00 am. ssh said: connect to host shed port 22: Connection timed out.",
  );

  // A desktop-app PC that was read before and whose folder has gone.
  const gone = await statusOf({ history: NOT_FOUND }, { history: NOT_FOUND, files: { "p/desktop.jsonl": DESKTOP_SESSION } });
  assert.equal(w.sourceCase(gone), "failing");
  assert.match(w.statusText(gone, FORMATS).text, /^No Claude Code prompt history or transcripts were found\..* Its numbers are the ones read at 1 Mar at 9:00 am\.$/);
  // It answered and had nothing: the Overview does not say it could not be read.
  assert.equal(
    w.staleText(gone, "this PC", FORMATS),
    "Nothing from Claude Code was found on this PC this time, so its numbers are the ones read at 1 Mar at 9:00 am. Looked for /made/up/.claude/history.jsonl and for transcripts beside it.",
  );

  // Transcripts that are there and cannot be read are a failure, with or without a history.
  const blocked: Listed = { ok: false, reason: "unreadable", detail: "/made/up/.claude/projects (EACCES)" };
  const noHistory = await statusOf({ history: NOT_FOUND, list: blocked });
  assert.equal(w.sourceCase(noHistory), "failing");
  assert.deepEqual(w.statusText(noHistory, FORMATS), { text: "Its transcripts could not be read: /made/up/.claude/projects (EACCES).", bad: true });
  const withHistory = await statusOf({ history: HISTORY, list: blocked });
  assert.equal(w.sourceCase(withHistory), "failing");
  assert.deepEqual(w.statusText(withHistory, FORMATS), { text: "2 prompts, the first on 2 Mar 2026. Its transcripts could not be read: /made/up/.claude/projects (EACCES). Read at noon.", bad: true });

  // Never read and cannot be: nothing is counted from it.
  const never = await statusOf(unreachable);
  assert.equal(w.sourceCase(never), "failing");
  assert.equal(w.isCounted(never), false);
  assert.deepEqual(w.noNumbersText([never], () => "Shed", FORMATS), {
    line: "None of your sources could be read, so there are no numbers to show.",
    detail: ["Shed: Could not be read. ssh said: connect to host shed port 22: Connection timed out."],
  });
  // One that failed beside one with nothing in it: neither sentence is said of the wrong one.
  const empty = await statusOf({ history: NOT_FOUND });
  assert.deepEqual(w.noNumbersText([never, empty], (x) => (x === never ? "Shed" : "This PC"), FORMATS), {
    line: "There are no numbers to show.",
    detail: ["Shed: Could not be read. ssh said: connect to host shed port 22: Connection timed out.", "This PC: nothing from Claude Code was found there."],
  });
});

test("not read yet says so, or when it was last read", () => {
  const w = words();
  const store = emptyStore("UTC");
  const unread = new Session(store).status(SHED);
  assert.equal(w.sourceCase(unread), "unread");
  assert.deepEqual(w.statusText(unread, FORMATS), { text: "Not read yet.", bad: false });
  store.sources["ssh:shed"] = { files: {}, transcriptsReadAt: NOW };
  assert.deepEqual(w.statusText(new Session(store).status(SHED), FORMATS), { text: "Last read at 1 Mar at 9:00 am.", bad: false });
});

// ----------------------------------------------------- what leaves another box

const posix = { skip: process.platform === "win32" && "grep is not on a Windows PC" };

test("the other box sends typed lines and queued prompts, and no tool results", posix, () => {
  const lines = [
    typed({ at: "2026-03-02T10:00:00Z" }),
    queued("2026-03-02T10:06:00Z", "2026-03-02T10:07:00Z"),
    reply({ at: "2026-03-02T10:08:00Z", id: "m1" }),
    // A tool result as it is in a real file: what it quotes is escaped inside its string.
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: JSON.stringify({ type: "user", origin: { kind: "human" }, text: "made-up" }) }] }, timestamp: "2026-03-02T10:09:00Z" }),
    typed({ at: "2026-03-02T10:10:00Z", meta: true, origin: null }),
    JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
  ];
  // The same pattern the other box is given, run by the program it is run by.
  const sent = execFileSync("grep", ["-E", WANTED_LINES], { input: lines.join("\n") + "\n", encoding: "utf8" }).trimEnd().split("\n");
  assert.deepEqual(sent, lines.slice(0, 3));
  assert.deepEqual(lines.map(isWanted), [true, true, true, false, false, false]);
  assert.doesNotMatch(WANTED_LINES, /["'\\]/);
});

// ------------------------------------------------------------------ the store

test("a store from the version before has every transcript marked to be read again, and keeps what it had", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibehours-store-"));
  const files = applyFiles({}, [fileOf("p/a.jsonl", [reply({ at: "2026-03-02T10:00:30Z", id: "m1" })])], "UTC").files;
  delete files["p/a.jsonl"].typed;
  const old = { version: 2, zone: "UTC", sources: { local: { files, prompts: { readAt: NOW, rows: [[NOW, "h", -1]], folders: [], dropped: 0, badLines: 0 } } } };
  writeFileSync(join(dir, "store.json"), JSON.stringify(old));
  const loaded = loadStore(dir, "UTC");
  assert.equal(loaded.setAside, null);
  assert.equal(loaded.store.version, 3);
  assert.equal(loaded.store.sources.local.files["p/a.jsonl"].size, -1);
  assert.deepEqual(loaded.store.sources.local.files["p/a.jsonl"].ids, files["p/a.jsonl"].ids);
  assert.equal(loaded.store.sources.local.prompts?.rows?.length, 1);
});
