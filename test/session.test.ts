// Made-up sources, histories and transcripts only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isWanted } from "../src/engine/transcripts";
import { Session } from "../src/main/session";
import type { Fetched, Listed, Reader, Source } from "../src/main/sources";
import { emptyStore, type Store } from "../src/main/store";
import { costState, reply } from "./made-up";

const DESK: Source = { kind: "local" };
const SHED: Source = { kind: "ssh", host: "shed" };
const ATTIC: Source = { kind: "ssh", host: "attic" };

function line(at: string, display: string, project?: string): string {
  return JSON.stringify({ display, timestamp: Date.parse(at), project });
}

interface Box {
  history: Fetched;
  /** Transcript files by path, as lines. Absent: the box has none. */
  files?: Record<string, string[]>;
  list?: Listed;
}

function nameOf(source: Source): string {
  return source.kind === "ssh" ? source.host : source.kind;
}

/** A stand-in for the PC and the boxes it can reach. */
function world(boxes: Record<string, Box>, store: Store = emptyStore("UTC")) {
  const calls: string[] = [];
  let saves = 0;
  const reader: Reader = {
    async history(source) {
      calls.push(`history ${nameOf(source)}`);
      return boxes[nameOf(source)].history;
    },
    async list(source) {
      calls.push(`list ${nameOf(source)}`);
      const box = boxes[nameOf(source)];
      if (box.list) return box.list;
      const files = Object.entries(box.files ?? {}).map(([path, lines]) => ({ path, size: lines.join("\n").length }));
      return { ok: true, files, keepsLonger: null };
    },
    async pull(source, paths, onLine) {
      calls.push(`pull ${nameOf(source)} ${paths.join(" ")}`);
      for (const path of paths) for (const l of boxes[nameOf(source)].files?.[path] ?? []) if (isWanted(l)) onLine(path, l);
      return { ok: true };
    },
  };
  const session = new Session(store, reader, () => saves++);
  return { session, calls, store, saves: () => saves };
}

const NOW = Date.parse("2026-03-02T12:00:00Z");
const NOT_FOUND: Fetched = { ok: false, reason: "not-found", detail: "/made/up/history.jsonl" };

test("one source failing does not blank the numbers; its status says why", async () => {
  const { session } = world({
    local: { history: { ok: true, text: [line("2026-03-02T10:00:00Z", "one"), line("2026-03-02T10:20:00Z", "two")].join("\n") } },
    shed: { history: { ok: false, reason: "failed", detail: "ssh: connect to host shed port 22: Connection timed out" } },
  });
  await Promise.all([session.read(DESK), session.read(SHED)]);

  const numbers = session.numbers([DESK, SHED], "UTC", NOW);
  assert.ok(numbers.report?.headline);
  assert.equal(numbers.report.headline.prompts, 2);
  assert.equal(numbers.report.headline.activeDays, 1);

  assert.equal(session.status(DESK).state, "ok");
  const shed = session.status(SHED);
  assert.equal(shed.state, "failed");
  assert.equal(shed.state === "failed" && shed.detail, "ssh: connect to host shed port 22: Connection timed out");
  assert.equal(shed.storedAt, null);
});

test("a box that could not be reached is not asked a second time for its transcripts", async () => {
  const { session, calls } = world({ shed: { history: { ok: false, reason: "failed", detail: "Connection refused" } } });
  await session.read(SHED);
  assert.deepEqual(calls, ["history shed"]);
  assert.equal(session.status(SHED).transcripts.state, "unread");
});

test("every source failing is no numbers, not zeros", async () => {
  const { session } = world({
    local: { history: NOT_FOUND },
    shed: { history: { ok: false, reason: "program-missing", detail: "ssh" } },
  });
  await Promise.all([session.read(DESK), session.read(SHED)]);
  const numbers = session.numbers([DESK, SHED], "UTC", NOW);
  assert.equal(numbers.report, null);
  assert.equal(numbers.usage, null);
});

test("two sources are merged, and a prompt in both is counted once", async () => {
  const shared = line("2026-03-02T10:00:00Z", "in both");
  const { session } = world({
    shed: { history: { ok: true, text: [shared, line("2026-03-02T10:10:00Z", "shed only")].join("\n") } },
    attic: { history: { ok: true, text: [shared, line("2026-03-02T10:20:00Z", "attic only")].join("\n") } },
  });
  await session.read(SHED);
  await session.read(ATTIC);
  const numbers = session.numbers([SHED, ATTIC], "UTC", NOW);
  assert.equal(numbers.duplicates, 1);
  assert.equal(numbers.report?.headline?.prompts, 3);
  assert.equal(numbers.report?.days[0].blocks, 1);
});

test("a source's status holds counts and times, never text", async () => {
  const { session } = world({
    local: { history: { ok: true, text: [line("2026-03-02T10:20:00Z", "later"), line("2026-03-01T09:00:00Z", "earlier")].join("\n") } },
  });
  await session.read(DESK, undefined, () => NOW);
  assert.deepEqual(session.status(DESK), {
    source: DESK,
    state: "ok",
    readAt: NOW,
    prompts: 2,
    firstPrompt: Date.parse("2026-03-01T09:00:00Z"),
    reading: null,
    storedAt: NOW,
    transcriptsStoredAt: NOW,
    transcripts: { state: "ok", readAt: NOW, files: 0, read: 0, changed: 0 },
    keepsLonger: null,
  });
  assert.equal(session.status(SHED).state, "unread");
});

test("numbers read nothing: a source is read only when asked", async () => {
  const { session, calls } = world({ shed: { history: { ok: true, text: line("2026-03-02T10:00:00Z", "one") } } });
  session.numbers([SHED], "UTC", NOW);
  session.status(SHED);
  assert.deepEqual(calls, []);
  await session.read(SHED);
  session.numbers([SHED], "UTC", NOW);
  assert.deepEqual(calls, ["history shed", "list shed"]);
});

test("the store holds times and totals, and no prompt or reply text", async () => {
  const { session, store } = world({
    shed: {
      history: { ok: true, text: [line("2026-03-02T10:00:00Z", "a made-up secret prompt", "/made/up/project"), line("2026-03-02T10:10:00Z", "another one")].join("\n") },
      files: { "p/a.jsonl": [reply({ at: "2026-03-02T10:01:00Z", id: "msg-1", tools: ["Bash"] })] },
    },
  });
  await session.read(SHED, undefined, () => NOW);
  const kept = JSON.stringify(store);
  assert.doesNotMatch(kept, /secret|another one|reply words|msg-1/);
  // A prompt is kept as its time, a short hash and its folder's place in a list.
  const prompts = store.sources["ssh:shed"].prompts;
  assert.deepEqual(prompts?.rows?.map((r) => [r[0], r[2]]), [
    [Date.parse("2026-03-02T10:00:00Z"), 0],
    [Date.parse("2026-03-02T10:10:00Z"), -1],
  ]);
  assert.deepEqual(prompts?.folders, ["/made/up/project"]);
  assert.ok(prompts?.rows?.every((r) => /^[0-9a-z]{6,12}$/.test(r[1])));
  assert.equal(prompts?.spans, undefined);
});

test("one box ticked under two names shows its prompts once on open, before either is read again", async () => {
  const history = { ok: true as const, text: [line("2026-03-02T10:00:00Z", "one"), line("2026-03-02T10:20:00Z", "two")].join("\n") };
  const boxes = { shed: { history }, attic: { history } };
  const first = world(boxes);
  await first.session.read(SHED, undefined, () => NOW);
  await first.session.read(ATTIC, undefined, () => NOW);

  const reopened = world(boxes, JSON.parse(JSON.stringify(first.store)) as Store);
  const shown = reopened.session.numbers([SHED, ATTIC], "UTC", NOW);
  assert.deepEqual(reopened.calls, []);
  assert.equal(shown.report?.headline?.prompts, 2);
  assert.equal(shown.duplicates, 2);

  // And with one of the two read and the other still as stored.
  await reopened.session.read(SHED, undefined, () => NOW);
  const half = reopened.session.numbers([SHED, ATTIC], "UTC", NOW);
  assert.equal(half.report?.headline?.prompts, 2);
  assert.equal(half.duplicates, 2);
});

test("stretches kept by version 1 still give the hours, and are replaced by the next read", async () => {
  const store = emptyStore("UTC");
  const from = Date.parse("2026-03-02T10:00:00Z");
  store.sources["ssh:shed"] = { files: {}, prompts: { readAt: 1, spans: [[from, from + 20 * 60_000, 2]], dropped: 0, badLines: 0 } };
  const { session } = world(
    { shed: { history: { ok: true, text: [line("2026-03-02T10:00:00Z", "one"), line("2026-03-02T10:20:00Z", "two")].join("\n") } } },
    store,
  );
  const before = session.numbers([SHED], "UTC", NOW);
  assert.equal(before.report?.headline?.prompts, 2);
  assert.equal(before.report?.headline?.totalHours, 0.5);
  await session.read(SHED, undefined, () => NOW);
  assert.equal(store.sources["ssh:shed"].prompts?.spans, undefined);
  assert.equal(store.sources["ssh:shed"].prompts?.rows?.length, 2);
  assert.deepEqual(session.numbers([SHED], "UTC", NOW).report?.headline, before.report?.headline);
});

test("the app opens on what the store holds: a new session shows the numbers before anything is read", async () => {
  const boxes = {
    shed: {
      history: { ok: true as const, text: [line("2026-03-02T10:00:00Z", "one"), line("2026-03-02T10:20:00Z", "two")].join("\n") },
      files: { "p/a.jsonl": [reply({ at: "2026-03-02T10:01:00Z", id: "msg-1" }), costState("session-a", 1, 3)] },
    },
  };
  const first = world(boxes);
  await first.session.read(SHED, undefined, () => NOW);
  const read = first.session.numbers([SHED], "UTC", NOW);
  assert.ok(first.saves() > 0);

  // The app is closed and opened: a new session over the same store.
  const reopened = world(boxes, JSON.parse(JSON.stringify(first.store)) as Store);
  const shown = reopened.session.numbers([SHED], "UTC", NOW);
  assert.deepEqual(reopened.calls, []);
  assert.deepEqual(shown.report?.headline, read.report?.headline);
  assert.deepEqual(shown.usage, read.usage);
  assert.equal(reopened.session.status(SHED).state, "unread");
  assert.equal(reopened.session.status(SHED).storedAt, NOW);
});

test("a source that used to read and now fails keeps its numbers, and its status says both", async () => {
  const boxes: Record<string, Box> = {
    local: { history: { ok: true, text: line("2026-03-02T10:00:00Z", "one") } },
    shed: { history: { ok: true, text: line("2026-03-02T11:00:00Z", "two") } },
  };
  const { session } = world(boxes);
  await session.read(DESK);
  await session.read(SHED, undefined, () => NOW);
  assert.equal(session.numbers([DESK, SHED], "UTC", NOW).report?.headline?.prompts, 2);

  boxes.shed = { history: { ok: false, reason: "failed", detail: "Connection refused" } };
  await session.read(SHED);
  assert.equal(session.numbers([DESK, SHED], "UTC", NOW).report?.headline?.prompts, 2);
  const shed = session.status(SHED);
  assert.equal(shed.state, "failed");
  assert.equal(shed.storedAt, NOW);
  assert.equal(session.hasStored(SHED), true);

  // A source taken off the list is no longer counted.
  session.forget(DESK);
  assert.equal(session.status(DESK).state, "unread");
  assert.equal(session.numbers([SHED], "UTC", NOW).report?.headline?.prompts, 1);
});

test("a history whose fields have been renamed gives no numbers of its own, and the stored ones stay", async () => {
  const good = [line("2026-03-02T10:00:00Z", "one"), line("2026-03-02T10:20:00Z", "two"), line("2026-03-02T10:40:00Z", "three")];
  const boxes: Record<string, Box> = { shed: { history: { ok: true, text: good.join("\n") } } };
  const { session, store } = world(boxes);
  await session.read(SHED, undefined, () => NOW);
  const before = JSON.stringify(store.sources["ssh:shed"].prompts);

  // A release renames `timestamp`. One old line is still in the file.
  const renamed = good.map((l) => l.replace('"timestamp"', '"time"'));
  boxes.shed = { history: { ok: true, text: [...renamed, line("2026-03-03T10:00:00Z", "four")].join("\n") } };
  await session.read(SHED, undefined, () => NOW + 1);
  const status = session.status(SHED);
  assert.deepEqual(
    status.state === "failed" && [status.reason, status.detail],
    ["changed", "3 of 4"],
  );
  assert.equal(JSON.stringify(store.sources["ssh:shed"].prompts), before);
  // Not one prompt from the line that parsed: the three from before.
  assert.equal(session.numbers([SHED], "UTC", NOW).report?.headline?.prompts, 3);
});

test("only transcripts whose size has changed are read again", async () => {
  const boxes: Record<string, Box> = {
    shed: {
      history: NOT_FOUND,
      files: {
        "p/a.jsonl": [reply({ at: "2026-03-02T10:00:00Z", id: "a-1" })],
        "p/b.jsonl": [reply({ at: "2026-03-02T11:00:00Z", id: "b-1", session: "session-b" })],
      },
    },
  };
  const { session, calls } = world(boxes);
  await session.read(SHED);
  await session.read(SHED);
  boxes.shed.files!["p/b.jsonl"].push(reply({ at: "2026-03-02T11:05:00Z", id: "b-2", session: "session-b" }));
  await session.read(SHED);
  assert.deepEqual(calls.filter((c) => c.startsWith("pull")), ["pull shed p/a.jsonl p/b.jsonl", "pull shed p/b.jsonl"]);
  const status = session.status(SHED);
  assert.deepEqual(status.transcripts.state === "ok" && [status.transcripts.files, status.transcripts.read], [2, 1]);
  assert.equal(session.numbers([SHED], "UTC", NOW).usage?.replies, 3);
});

test("a transcript that has vanished keeps the days it gave", async () => {
  const boxes: Record<string, Box> = {
    shed: {
      history: NOT_FOUND,
      files: {
        "p/old.jsonl": [reply({ at: "2026-02-01T10:00:00Z", id: "old-1", session: "session-old" }), costState("session-old", 1, 7)],
        "p/new.jsonl": [reply({ at: "2026-03-02T10:00:00Z", id: "new-1", session: "session-new" })],
      },
    },
  };
  const { session } = world(boxes);
  await session.read(SHED);
  const before = session.numbers([SHED], "UTC", NOW).usage;
  assert.equal(before?.range.from, "2026-02-01");

  // Claude Code deletes the old one.
  delete boxes.shed.files!["p/old.jsonl"];
  await session.read(SHED);
  assert.deepEqual(session.numbers([SHED], "UTC", NOW).usage, before);
});

test("a transcript in a changed format is named, and what was stored for it is left as it was", async () => {
  const good = [reply({ at: "2026-03-02T10:00:00Z", id: "a-1" }), reply({ at: "2026-03-02T10:01:00Z", id: "a-2" })];
  const boxes: Record<string, Box> = { shed: { history: NOT_FOUND, files: { "p/a.jsonl": good } } };
  const { session } = world(boxes);
  await session.read(SHED);
  const before = session.numbers([SHED], "UTC", NOW).usage;

  boxes.shed.files!["p/a.jsonl"] = [...good, reply({ at: "2026-03-02T10:02:00Z", id: "a-3" })].map((l) =>
    l.replace('"message"', '"reply"'),
  );
  await session.read(SHED);
  const status = session.status(SHED);
  assert.equal(status.transcripts.state === "ok" && status.transcripts.changed, 1);
  assert.deepEqual(session.numbers([SHED], "UTC", NOW).usage, before);
});

test("when the transcripts cannot be listed, the prompting hours still show and the reason is kept", async () => {
  const { session } = world({
    shed: {
      history: { ok: true, text: line("2026-03-02T10:00:00Z", "one") },
      list: { ok: false, reason: "failed", detail: "The list of transcripts was cut short." },
    },
  });
  await session.read(SHED);
  const status = session.status(SHED);
  assert.equal(status.state, "ok");
  assert.deepEqual(status.transcripts.state === "failed" && status.transcripts.detail, "The list of transcripts was cut short.");
  assert.equal(session.numbers([SHED], "UTC", NOW).report?.headline?.prompts, 1);
});

test("the page is told each time there is something new: started, on to transcripts, landed", async () => {
  const { session } = world({
    shed: { history: { ok: true, text: line("2026-03-02T10:00:00Z", "one") }, files: { "p/a.jsonl": [reply({ at: "2026-03-02T10:01:00Z", id: "a-1" })] } },
  });
  const seen: (string | null)[] = [];
  await session.read(SHED, () => seen.push(session.status(SHED).reading));
  assert.deepEqual(seen, ["history", "transcripts", null]);
});

test("names hidden: what goes to the page holds no folder name and no word, and the store is no different", async () => {
  const text = [
    line("2026-03-02T10:00:00Z", "tidy the orchard notes", "/home/sam/orchard"),
    line("2026-03-02T10:10:00Z", "tidy the orchard notes again", "/home/sam/orchard"),
    line("2026-03-02T11:30:00Z", "tidy up", "/home/sam/cellar"),
  ].join("\n");
  const { session, store } = world({ shed: { history: { ok: true, text }, files: { "p/a.jsonl": [reply({ at: "2026-03-02T10:01:00Z", id: "msg-1" })] } } });
  await session.read(SHED, undefined, () => NOW);

  const open = session.numbers([SHED], "UTC", NOW, { planPrice: "$20" });
  assert.deepEqual(open.screens.projects.map((p) => p.name), ["orchard", "cellar", "project"]);
  assert.deepEqual(open.screens.words?.words, [["tidy", 3], ["notes", 2], ["orchard", 2]]);
  assert.equal(open.screens.plan?.price.amount, 20);

  const kept = JSON.stringify(store);
  const hidden = session.numbers([SHED], "UTC", NOW, { hideNames: true });
  assert.deepEqual(hidden.screens.projects.map((p) => p.name), ["Project 1", "Project 2", "Project 3"]);
  assert.equal(hidden.screens.words, null);
  assert.doesNotMatch(JSON.stringify(hidden), /orchard|cellar|sam|tidy|notes|made\/up/);
  assert.deepEqual(hidden.report, open.report);
  assert.deepEqual(hidden.usage, open.usage);
  // Words are counted in memory and never kept.
  assert.equal(JSON.stringify(store), kept);
  assert.doesNotMatch(kept, /tidy|notes again/);
});
