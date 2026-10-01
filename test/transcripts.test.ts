// Every transcript here is made up. No real transcript is ever used in a test.

import assert from "node:assert/strict";
import { test } from "node:test";
import { activeDays, spansOf, type Span } from "../src/engine/hours";
import {
  TranscriptFile,
  applyFiles,
  buildUsage,
  isWanted,
  type FileTotals,
} from "../src/engine/transcripts";
import { costState, reply } from "./made-up";

const UTC = "UTC";
const NOW = Date.parse("2026-03-10T12:00:00Z");

function system(at: string, session = "session-a", extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "system", subtype: "stop_hook_summary", timestamp: at, sessionId: session, ...extra });
}

function read(path: string, lines: string[]): TranscriptFile {
  const file = new TranscriptFile(path, lines.join("\n").length);
  for (const line of lines) if (isWanted(line)) file.feed(line);
  return file;
}

function totalsOf(path: string, lines: string[], known: Record<string, FileTotals> = {}): FileTotals {
  return applyFiles(known, [read(path, lines)], UTC).files[path];
}

function usageOf(files: Record<string, FileTotals>, extra: { promptSpans?: Span[]; promptingHours?: Map<string, number> } = {}) {
  const usage = buildUsage([files], { zone: UTC, now: NOW, ...extra });
  assert.ok(usage);
  return usage;
}

function near(actual: number | null, expected: number, eps = 1e-9): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < eps, `${actual} is not ${expected}`);
}

test("a reply written on three lines is counted once", () => {
  const lines = ["10:00:00", "10:00:01", "10:00:02"].map((t) => reply({ at: `2026-03-02T${t}Z`, id: "msg-1" }));
  const totals = totalsOf("p/a.jsonl", lines);
  assert.deepEqual(totals.days["2026-03-02"].models, { "claude-made-up-1": [10, 100, 1000, 50, 1] });
  assert.equal(totals.ids.length, 1);
});

test("when a reply's lines disagree, the last is taken", () => {
  const totals = totalsOf("p/a.jsonl", [
    reply({ at: "2026-03-02T10:00:00Z", id: "msg-1", usage: [10, 5, 1000, 50] }),
    reply({ at: "2026-03-02T10:00:01Z", id: "msg-1", usage: [10, 40, 1000, 50] }),
    reply({ at: "2026-03-02T10:00:02Z", id: "msg-1", usage: [10, 90, 1000, 50] }),
  ]);
  assert.deepEqual(totals.days["2026-03-02"].models["claude-made-up-1"], [10, 90, 1000, 50, 1]);
});

test("the same reply in two files is counted once", () => {
  const shared = reply({ at: "2026-03-02T10:00:00Z", id: "msg-shared" });
  const main = read("p/a.jsonl", [shared, reply({ at: "2026-03-02T10:05:00Z", id: "msg-main" })]);
  const sub = read("p/a/subagents/agent-1.jsonl", [shared, reply({ at: "2026-03-02T10:06:00Z", id: "msg-sub" })]);
  const { files } = applyFiles({}, [sub, main], UTC);
  const usage = usageOf(files);
  assert.equal(usage.replies, 3);
  assert.deepEqual(usage.tokens, [30, 300, 3000, 150]);
  assert.equal(files["p/a/subagents/agent-1.jsonl"].sub, true);
  assert.equal(usage.subAgents, 1);

  // And once more when the two files are read at different times.
  const first = applyFiles({}, [main], UTC).files;
  const second = applyFiles(first, [sub], UTC).files;
  assert.deepEqual(usageOf({ ...first, ...second }).tokens, [30, 300, 3000, 150]);
});

test("a line whose model is <synthetic> is not a model call", () => {
  const totals = totalsOf("p/a.jsonl", [
    reply({ at: "2026-03-02T10:00:00Z", id: "msg-1" }),
    reply({ at: "2026-03-02T10:01:00Z", id: "msg-2", model: "<synthetic>", usage: [0, 0, 0, 0] }),
  ]);
  assert.deepEqual(Object.keys(totals.days["2026-03-02"].models), ["claude-made-up-1"]);
  assert.equal(totals.ids.length, 1);
  assert.equal(totals.bad, 0);
});

test("a file that has grown is read again without counting its old replies twice", () => {
  const early = [reply({ at: "2026-03-02T10:00:00Z", id: "msg-1" }), reply({ at: "2026-03-02T10:01:00Z", id: "msg-2", usage: [1, 20, 0, 0] })];
  const before = { "p/a.jsonl": totalsOf("p/a.jsonl", early) };
  // msg-2 was still streaming; its usage has grown, and a third reply has come.
  const later = [
    ...early,
    reply({ at: "2026-03-02T10:01:05Z", id: "msg-2", usage: [1, 70, 0, 0] }),
    reply({ at: "2026-03-03T09:00:00Z", id: "msg-3" }),
  ];
  const after = { ...before, ...applyFiles(before, [read("p/a.jsonl", later)], UTC).files };
  const usage = usageOf(after);
  assert.equal(usage.replies, 3);
  assert.deepEqual(usage.tokens, [21, 270, 2000, 100]);

  // Reading the same file twice gives the same totals.
  const again = { ...after, ...applyFiles(after, [read("p/a.jsonl", later)], UTC).files };
  assert.deepEqual(usageOf(again), usage);
});

test("missing is not zero: a day with no transcript has no tokens, and a session with no record has no cost", () => {
  const files = {
    "p/a.jsonl": totalsOf("p/a.jsonl", [
      reply({ at: "2026-03-02T10:00:00Z", id: "msg-1" }),
      reply({ at: "2026-03-04T10:00:00Z", id: "msg-2", usage: [0, 0, 0, 0] }),
    ]),
  };
  const usage = usageOf(files);
  const byDay = new Map(usage.days.map((d) => [d.day, d]));
  assert.equal(byDay.get("2026-03-03")?.tokens, null);
  assert.deepEqual(byDay.get("2026-03-04")?.tokens, [0, 0, 0, 0]);
  assert.equal(usage.cost, null);
  assert.equal(usage.linesAdded, null);
  assert.equal(usage.sessionsWithoutCost, 1);
  assert.equal(buildUsage([{}], { zone: UTC, now: NOW }), null);
});

test("two sessions at once count once for hours, and are the most at once", () => {
  const a = totalsOf("p/a.jsonl", [
    reply({ at: "2026-03-02T10:00:00Z", id: "a-1", session: "session-a" }),
    reply({ at: "2026-03-02T11:00:00Z", id: "a-2", session: "session-a" }),
    system("2026-03-02T10:30:00Z", "session-a"),
  ]);
  const b = totalsOf("p/b.jsonl", [
    system("2026-03-02T10:20:00Z", "session-b"),
    system("2026-03-02T10:45:00Z", "session-b"),
    reply({ at: "2026-03-02T11:10:00Z", id: "b-1", session: "session-b" }),
    reply({ at: "2026-03-02T11:30:00Z", id: "b-2", session: "session-b" }),
  ]);
  const usage = usageOf({ "p/a.jsonl": a, "p/b.jsonl": b });
  // 10:00 to 11:30 across both, plus the ten-minute tail.
  near(usage.sessionHours, 1.5 + 10 / 60);
  assert.deepEqual(usage.mostAtOnce, { sessions: 2, day: "2026-03-02" });
  // Their tokens both count.
  assert.equal(usage.replies, 4);
});

test("agent hours are session hours less prompting hours, never below zero", () => {
  const files = {
    "p/a.jsonl": totalsOf("p/a.jsonl", [
      reply({ at: "2026-03-02T10:05:00Z", id: "a-1" }),
      reply({ at: "2026-03-02T10:30:00Z", id: "a-2" }),
      reply({ at: "2026-03-02T10:55:00Z", id: "a-3" }),
      reply({ at: "2026-03-02T11:20:00Z", id: "a-4" }),
    ]),
  };
  // Typed prompts at 10:00 and 10:10: a 20-minute prompting block.
  const prompts = [Date.parse("2026-03-02T10:00:00Z"), Date.parse("2026-03-02T10:10:00Z")];
  const usage = usageOf(files, { promptSpans: spansOf(prompts), promptingHours: new Map([["2026-03-02", 20 / 60]]) });
  // The session ran 10:00 to 11:20 plus the tail; the typed prompts are part of it.
  near(usage.sessionHours, 1.5);
  near(usage.agentHours, 1.5 - 20 / 60);
  // A day with more prompting counted than session time gives zero, not a negative.
  const odd = usageOf(files, { promptingHours: new Map([["2026-03-02", 9]]) });
  assert.equal(odd.agentHours, 0);
});

test("a session's cost is the last record of each run, added up, and spread by output tokens", () => {
  const start1 = Date.parse("2026-03-02T09:59:00Z");
  const start2 = Date.parse("2026-03-03T08:00:00Z");
  const files = {
    "p/a.jsonl": totalsOf("p/a.jsonl", [
      reply({ at: "2026-03-02T10:00:00Z", id: "a-1", usage: [0, 300, 0, 0] }),
      costState("session-a", start1, 2, 10, 1),
      costState("session-a", start1, 6, 30, 3),
      // The same run again, lower: the last is taken, not the largest.
      costState("session-a", start1, 5, 30, 3),
      // Closed and resumed: a new run whose totals begin again, below the first.
      reply({ at: "2026-03-03T08:01:00Z", id: "a-2", usage: [0, 100, 0, 0] }),
      costState("session-a", start2, 1, 10, 1),
      costState("session-a", start2, 3, 10, 1),
    ]),
  };
  const usage = usageOf(files);
  near(usage.cost, 8);
  near(usage.linesAdded, 40);
  near(usage.linesRemoved, 4);
  const byDay = new Map(usage.days.map((d) => [d.day, d.cost]));
  near(byDay.get("2026-03-02") ?? null, 6);
  near(byDay.get("2026-03-03") ?? null, 2);
  assert.equal(byDay.get("2026-03-04"), null);
  assert.equal(usage.sessionsWithoutCost, 0);
});

test("tool uses are counted by name, mcp tools as one, and no reply text is kept", () => {
  const totals = totalsOf("p/a.jsonl", [
    reply({ at: "2026-03-02T10:00:00Z", id: "a-1", tools: ["Bash"] }),
    reply({ at: "2026-03-02T10:00:01Z", id: "a-1", tools: ["Edit"] }),
    reply({ at: "2026-03-02T10:02:00Z", id: "a-2", tools: ["Bash", "mcp__shed__open", "mcp__attic__close"] }),
  ]);
  assert.deepEqual(totals.days["2026-03-02"].tools, { Bash: 2, Edit: 1, mcp: 2 });
  assert.equal(totals.folder, "/made/up/project");
  assert.doesNotMatch(JSON.stringify(totals), /made-up reply words/);
  assert.doesNotMatch(JSON.stringify(totals), /msg-|a-1/);
});

test("a headless run is kept out of the hours and shown apart; its tokens still count", () => {
  const files = {
    "p/a.jsonl": totalsOf("p/a.jsonl", [reply({ at: "2026-03-02T10:00:00Z", id: "a-1" })]),
    "p/night.jsonl": totalsOf("p/night.jsonl", [
      reply({ at: "2026-03-03T02:00:00Z", id: "n-1", session: "session-n", entrypoint: "sdk-cli" }),
      reply({ at: "2026-03-03T02:20:00Z", id: "n-2", session: "session-n", entrypoint: "sdk-cli" }),
    ]),
  };
  const usage = usageOf(files);
  near(usage.sessionHours, 10 / 60);
  assert.equal(usage.unattended.runs, 1);
  near(usage.unattended.hours, 0.5);
  assert.equal(usage.replies, 3);
  assert.deepEqual(usage.mostAtOnce, { sessions: 1, day: "2026-03-02" });
});

test("another kind of line that holds the marker text is not counted, and not a bad line", () => {
  const quoting = JSON.stringify({ type: "user", toolUseResult: { "type": "assistant" }, timestamp: "2026-03-02T10:00:00Z" });
  assert.equal(isWanted(quoting), true);
  const file = read("p/a.jsonl", [quoting, reply({ at: "2026-03-02T10:00:00Z", id: "a-1" })]);
  assert.equal(file.lines, 1);
  assert.equal(file.bad, 0);
  assert.equal(isWanted(JSON.stringify({ type: "user", message: { content: '{"type":"assistant"}' } })), false);
});

test("a transcript whose fields have been renamed is left out, not counted from the lines that parsed", () => {
  const renamed = (at: string, id: string) =>
    reply({ at, id }).replace('"usage"', '"tokenUsage"');
  const file = read("p/a.jsonl", [
    renamed("2026-03-02T10:00:00Z", "a-1"),
    renamed("2026-03-02T10:01:00Z", "a-2"),
    reply({ at: "2026-03-02T10:02:00Z", id: "a-3" }),
  ]);
  assert.equal(file.lines, 3);
  assert.equal(file.bad, 2);
  assert.equal(file.looksChanged, true);

  // What was stored for it stays exactly as it was.
  const before = { "p/a.jsonl": totalsOf("p/a.jsonl", [reply({ at: "2026-03-01T10:00:00Z", id: "a-0" })]) };
  const applied = applyFiles(before, [file], UTC);
  assert.deepEqual(applied.changed, ["p/a.jsonl"]);
  assert.deepEqual(applied.files, {});
});

test("a few bad lines in a good file are counted as bad and the rest still count", () => {
  const file = read("p/a.jsonl", [
    reply({ at: "2026-03-02T10:00:00Z", id: "a-1" }),
    reply({ at: "2026-03-02T10:01:00Z", id: "a-2" }),
    '{"type":"assistant","timestamp":"2026-03-02T10:02:00Z","message":{"id":"cut sho',
  ]);
  assert.equal(file.bad, 1);
  assert.equal(file.looksChanged, false);
  assert.equal(applyFiles({}, [file], UTC).files["p/a.jsonl"].ids.length, 2);
});

test("a token day is the 4am day of the reply in the home zone", () => {
  const lines = [reply({ at: "2026-03-02T16:30:00Z", id: "a-1" }), reply({ at: "2026-03-02T18:30:00Z", id: "a-2" })];
  // Brisbane is UTC+10: 02:30 on the 3rd is still the 2nd, 04:30 is the 3rd.
  const { files } = applyFiles({}, [read("p/a.jsonl", lines)], "Australia/Brisbane");
  assert.deepEqual(Object.keys(files["p/a.jsonl"].days).sort(), ["2026-03-02", "2026-03-03"]);
});

test("the same file seen through two sources is taken once", () => {
  const lines = [reply({ at: "2026-03-02T10:00:00Z", id: "a-1" }), costState("session-a", 1, 4)];
  const one = { "p/a.jsonl": totalsOf("p/a.jsonl", lines) };
  const two = { "p/a.jsonl": totalsOf("p/a.jsonl", lines) };
  const usage = buildUsage([one, two], { zone: UTC, now: NOW });
  assert.equal(usage?.replies, 1);
  near(usage?.cost ?? null, 4);
});

test("stretches kept from one source merge with another's times exactly as the raw times would", () => {
  const at = (t: string) => Date.parse(`2026-03-02T${t}:00Z`);
  // Each has gaps over 30 minutes that the other bridges.
  const shed = [at("10:00"), at("10:25"), at("11:40"), at("12:00")];
  const attic = [at("10:50"), at("11:15"), at("14:00")];
  assert.deepEqual(spansOf(shed), [
    [at("10:00"), at("10:25"), 2],
    [at("11:40"), at("12:00"), 2],
  ]);
  const raw = activeDays([...shed, ...attic].sort((a, b) => a - b), UTC);
  assert.equal(raw[0].blocks, 2);
  assert.deepEqual(activeDays(attic, UTC, spansOf(shed)), raw);
  assert.deepEqual(activeDays([], UTC, [...spansOf(shed), ...spansOf(attic)]), raw);
});
