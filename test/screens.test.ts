// Made-up histories and transcripts only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, mergeSources, parseRows, type PromptRow, type Report } from "../src/engine/hours";
import {
  buildScreens,
  countWords,
  lateNights,
  parsePlanPrice,
  planOver,
  projectRows,
  records,
  rhythm,
  squareLevel,
  weekStrip,
  yearSquares,
} from "../src/engine/screens";
import { TranscriptFile, applyFiles, buildUsage, folderTokens, type Usage } from "../src/engine/transcripts";
import { costState, reply } from "./made-up";

const UTC = "UTC";
const BRISBANE = "Australia/Brisbane";
const at = (iso: string) => Date.parse(iso);

function row(iso: string, display = "made-up prompt", project = "/made/up/project"): string {
  return JSON.stringify({ display, timestamp: at(iso), project });
}

/** A block of `hours` starting at `iso`: a prompt every 20 minutes, less the 10 minute tail. */
function block(iso: string, hours: number, project?: string): string[] {
  const out: string[] = [];
  const end = at(iso) + hours * 3_600_000 - 600_000;
  for (let t = at(iso); t < end; t += 1_200_000) out.push(row(new Date(t).toISOString(), `p ${t}`, project));
  out.push(row(new Date(end).toISOString(), `p ${end}`, project));
  return out;
}

function read(lines: string[], zone: string, now: string): { report: Report; rows: PromptRow[] } {
  const merged = mergeSources([parseRows(lines.join("\n"))]);
  return { report: buildReport(merged, { zone, now: at(now) }), rows: merged.rows };
}

// ---------------------------------------------------------------- this week

// 1 March 2026 is a Sunday.
const THREE_WEEKS = [
  // Week of 15 Feb: Monday 2 h, Wednesday 4 h.
  ...block("2026-02-16T10:00:00Z", 2),
  ...block("2026-02-18T10:00:00Z", 4),
  // Week of 22 Feb: Sunday 1 h, Saturday 3 h.
  ...block("2026-02-22T10:00:00Z", 1),
  ...block("2026-02-28T10:00:00Z", 3),
  // This week: Sunday 1.5 h.
  ...block("2026-03-01T10:00:00Z", 1.5),
];

test("the week strip starts again on a Sunday, and sits beside the whole weeks before it", () => {
  const { report } = read([...block("2026-02-08T10:00:00Z", 1), ...THREE_WEEKS], UTC, "2026-03-01T12:00:00Z");
  const strip = weekStrip(report, at("2026-03-01T12:00:00Z"));
  assert.ok(strip);
  assert.equal(strip.weekStart, "2026-03-01");
  assert.equal(strip.daysSoFar, 1);
  assert.equal(strip.activeDays, 1);
  assert.ok(Math.abs(strip.hours - 1.5) < 1e-9);
  // Three whole weeks before: 1 h, 6 h and 4 h, with 1, 2 and 2 days used.
  assert.equal(strip.average?.weeks, 3);
  assert.ok(Math.abs((strip.average?.hours ?? 0) - 11 / 3) < 1e-9);
  assert.ok(Math.abs((strip.average?.activeDays ?? 0) - 5 / 3) < 1e-9);
  // By the end of a Sunday those weeks had 1 h, 0 h and 1 h.
  assert.ok(Math.abs((strip.average?.hoursByNow ?? 0) - 2 / 3) < 1e-9);
  assert.ok(Math.abs((strip.average?.activeDaysByNow ?? 0) - 2 / 3) < 1e-9);
});

test("the day before a Sunday is the seventh day of the old week", () => {
  const { report } = read(THREE_WEEKS.slice(0, -5), UTC, "2026-02-28T23:00:00Z");
  const strip = weekStrip(report, at("2026-02-28T23:00:00Z"));
  assert.equal(strip?.weekStart, "2026-02-22");
  assert.equal(strip?.daysSoFar, 7);
  assert.ok(Math.abs((strip?.hours ?? 0) - 4) < 1e-9);
  // The first week in the history began on a Monday, so it is not a whole week.
  assert.equal(strip?.average, null);
});

test("before 4am on a Sunday it is still Saturday's week; at 4am the new week begins", () => {
  // Brisbane is UTC+10. 03:30 on Sunday 1 March there is 17:30 on Saturday in UTC.
  const lines = [...block("2026-02-23T00:00:00Z", 2), ...block("2026-02-28T16:00:00Z", 1.5)];
  const before = read(lines, BRISBANE, "2026-02-28T17:30:00Z");
  const strip = weekStrip(before.report, at("2026-02-28T17:30:00Z"));
  assert.equal(strip?.today, "2026-02-28");
  assert.equal(strip?.weekStart, "2026-02-22");
  assert.equal(strip?.daysSoFar, 7);
  // The block that began at 2am on Sunday belongs to Saturday, and so to the old week.
  assert.ok(Math.abs((strip?.hours ?? 0) - 3.5) < 1e-9);
  assert.equal(strip?.activeDays, 2);

  const after = read(lines, BRISBANE, "2026-02-28T18:30:00Z");
  const next = weekStrip(after.report, at("2026-02-28T18:30:00Z"));
  assert.equal(next?.today, "2026-03-01");
  assert.equal(next?.weekStart, "2026-03-01");
  assert.equal(next?.daysSoFar, 1);
  assert.equal(next?.hours, 0);
  assert.equal(next?.activeDays, 0);
});

test("no history, or a report that stops before today, has no week strip", () => {
  assert.equal(weekStrip(null, at("2026-03-01T12:00:00Z")), null);
  const cut = buildReport(mergeSources([parseRows(THREE_WEEKS.join("\n"))]), { zone: UTC, to: "2026-02-20" });
  assert.equal(weekStrip(cut, at("2026-03-01T12:00:00Z")), null);
});

// ------------------------------------------------------------------ records

function usageOf(files: Record<string, string[]>, now: string, zone = UTC) {
  const batch = Object.entries(files).map(([path, lines]) => {
    const file = new TranscriptFile(path, lines.join("\n").length);
    for (const l of lines) file.feed(l);
    return file;
  });
  const applied = applyFiles({}, batch, zone).files;
  return { files: applied, usage: buildUsage([applied], { zone, now: at(now) }) };
}

test("each record is the biggest of its kind, with its date", () => {
  const { report } = read(THREE_WEEKS, UTC, "2026-03-01T12:00:00Z");
  const { usage } = usageOf(
    {
      "p/a.jsonl": [
        reply({ at: "2026-02-27T10:00:00Z", id: "a1", session: "a", usage: [1, 10, 100, 1] }),
        reply({ at: "2026-02-27T10:20:00Z", id: "a2", session: "a", usage: [1, 10, 100, 1] }),
        // After a gap: a second, longer stretch of the same session the next day.
        reply({ at: "2026-02-28T10:00:00Z", id: "a3", session: "a", usage: [1, 10, 5000, 1] }),
        reply({ at: "2026-02-28T10:25:00Z", id: "a4", session: "a", usage: [1, 10, 100, 1] }),
        reply({ at: "2026-02-28T10:50:00Z", id: "a5", session: "a", usage: [1, 10, 100, 1] }),
      ],
      "p/b.jsonl": [reply({ at: "2026-02-28T10:30:00Z", id: "b1", session: "b", usage: [1, 10, 100, 1] })],
    },
    "2026-03-01T12:00:00Z",
  );
  const r = records(report, usage);
  assert.equal(r.biggestDay?.day, "2026-02-18");
  assert.ok(Math.abs((r.biggestDay?.hours ?? 0) - 4) < 1e-9);
  assert.deepEqual([r.busiestWeek?.weekStart, r.busiestWeek?.activeDays], ["2026-02-15", 2]);
  assert.ok(Math.abs((r.busiestWeek?.hours ?? 0) - 6) < 1e-9);
  // 10:00 to 10:50 and the 10 minute tail.
  assert.deepEqual(r.longestSession, { day: "2026-02-28", hours: 1 });
  assert.deepEqual(r.biggestTokenDay, { day: "2026-02-28", tokens: 5012 + 112 + 112 + 112 });
  // Two sessions were live at once on the 28th, one on the 27th.
  assert.deepEqual(usage?.days.map((d) => [d.day, d.atOnce]), [
    ["2026-02-27", 1],
    ["2026-02-28", 2],
    ["2026-03-01", 0],
  ]);
});

test("with no history and no transcripts every record is missing, not zero", () => {
  assert.deepEqual(records(null, null), { biggestDay: null, busiestWeek: null, longestSession: null, biggestTokenDay: null });
});

// -------------------------------------------------------------- the squares

test("a year of squares: a day with hours, a zero day and a day outside the history are three things", () => {
  const { report } = read([...block("2026-02-16T10:00:00Z", 2), ...block("2026-02-18T10:00:00Z", 4.5)], UTC, "2026-03-01T12:00:00Z");
  const year = yearSquares(report, at("2026-03-01T12:00:00Z"));
  assert.ok(year);
  assert.deepEqual([year.from, year.to, year.squares.length], ["2025-03-02", "2026-03-01", 365]);
  assert.equal(year.historyFrom, "2026-02-16");
  const square = (day: string) => year.squares.find((s) => s.day === day);
  assert.deepEqual(square("2026-02-15"), { day: "2026-02-15", hours: null, level: 0 });
  assert.deepEqual(square("2026-02-17"), { day: "2026-02-17", hours: 0, level: 0 });
  assert.equal(square("2026-02-16")?.level, 2);
  assert.equal(square("2026-02-18")?.level, 3);
  assert.equal(year.activeDays, 2);
  assert.ok(Math.abs(year.hours - 6.5) < 1e-9);
  assert.equal(yearSquares(null, at("2026-03-01T12:00:00Z")), null);
});

test("the squares darken at 2, 4 and 6 hours", () => {
  assert.deepEqual([0, 0.2, 1.99, 2, 3.99, 4, 5.99, 6, 11].map(squareLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

// ------------------------------------------------------------------- rhythm

test("weekdays and hours of the day are counted in the home zone", () => {
  const lines = [
    // 08:00 and 08:20 on Monday 2 March in Brisbane.
    row("2026-03-01T22:00:00Z", "one"),
    row("2026-03-01T22:20:00Z", "two"),
    // 02:00 on Tuesday in Brisbane: before 4am, so still Monday's day, but the hour is 2.
    row("2026-03-02T16:00:00Z", "three"),
    // 21:00 on Wednesday 4 March in Brisbane.
    row("2026-03-04T11:00:00Z", "four"),
  ];
  const { report, rows } = read(lines, BRISBANE, "2026-03-04T12:00:00Z");
  const beat = rhythm(report, rows, BRISBANE);
  assert.ok(beat);
  // Sunday first: Monday and Wednesday were used, Tuesday was not.
  assert.deepEqual(beat.weekdays.map((w) => [w.active, w.of]), [[0, 0], [1, 1], [0, 1], [1, 1], [0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(
    beat.hours.map((n, hour) => [hour, n]).filter(([, n]) => n > 0),
    [[2, 1], [8, 2], [21, 1]],
  );
  assert.deepEqual(beat.busiestHour, { hour: 8, prompts: 2 });
  // The same prompts in UTC fall on other days and other hours.
  const utc = read(lines, UTC, "2026-03-04T12:00:00Z");
  assert.deepEqual(rhythm(utc.report, utc.rows, UTC)?.busiestHour, { hour: 22, prompts: 2 });
});

test("a late night stays with the day it began", () => {
  const lines = [
    // Monday: 22:00 to 01:30 Brisbane, so it ran past midnight.
    ...block("2026-03-02T12:00:00Z", 3.5 + 1 / 6),
    // Tuesday: finished at 23:50.
    row("2026-03-03T13:50:00Z", "late but not past midnight"),
    // Wednesday: 03:10 on Thursday morning, the latest of all.
    row("2026-03-04T17:10:00Z", "very late"),
    // Thursday: starts at 04:05, so it is Thursday's, and not a late night.
    row("2026-03-04T18:05:00Z", "early"),
  ];
  const { report } = read(lines, BRISBANE, "2026-03-05T02:00:00Z");
  const late = lateNights(report, BRISBANE);
  assert.equal(late?.activeDays, 4);
  assert.equal(late?.pastMidnight, 2);
  assert.deepEqual(late?.latest, { day: "2026-03-04", at: at("2026-03-04T17:10:00Z"), pastMidnight: true });

  const early = read([row("2026-03-02T00:00:00Z"), row("2026-03-03T03:00:00Z")], BRISBANE, "2026-03-03T04:00:00Z");
  assert.deepEqual(lateNights(early.report, BRISBANE), {
    activeDays: 2,
    pastMidnight: 0,
    latest: { day: "2026-03-03", at: at("2026-03-03T03:00:00Z"), pastMidnight: false },
  });
});

// ----------------------------------------------------------- the plan price

test("a plan price is read as typed, sign and all, and nothing is assumed about its currency", () => {
  assert.deepEqual(parsePlanPrice("$170"), { before: "$", amount: 170, after: "" });
  assert.deepEqual(parsePlanPrice(" A$ 1,170.50 "), { before: "A$", amount: 1170.5, after: "" });
  assert.deepEqual(parsePlanPrice("200 EUR"), { before: "", amount: 200, after: "EUR" });
  assert.deepEqual(parsePlanPrice("20"), { before: "", amount: 20, after: "" });
  for (const bad of ["", "free", "$", "0", "-5", "12 34", undefined, null]) assert.equal(parsePlanPrice(bad), null);
  // A month is a twelfth of a year.
  assert.ok(Math.abs(planOver({ before: "$", amount: 365.25, after: "" }, 30) - 360) < 1e-9);
});

test("value against the plan: beside the plan with a price, alone without one", () => {
  const { report, rows } = read([row("2026-02-27T10:00:00Z")], UTC, "2026-03-01T12:00:00Z");
  const { usage } = usageOf(
    { "p/a.jsonl": [reply({ at: "2026-02-27T10:00:00Z", id: "a1", session: "a" }), costState("a", 1, 12.5)] },
    "2026-03-01T12:00:00Z",
  );
  const input = { report, usage, rows, folderTokens: new Map<string, Usage>(), zone: UTC, now: at("2026-03-01T12:00:00Z") };
  assert.equal(usage?.cost, 12.5);
  assert.equal(buildScreens(input).plan, null);
  assert.equal(buildScreens({ ...input, planPrice: "not a price" }).plan, null);
  const plan = buildScreens({ ...input, planPrice: "A$170" }).plan;
  assert.deepEqual(plan?.price, { before: "A$", amount: 170, after: "" });
  // 27 Feb to 1 Mar is three days.
  assert.equal(plan?.days, 3);
  assert.ok(Math.abs((plan?.cost ?? 0) - (170 * 12 * 3) / 365.25) < 1e-9);
  // A price with no transcripts has nothing to sit beside.
  assert.equal(buildScreens({ ...input, usage: null, planPrice: "A$170" }).plan, null);
});

// -------------------------------------------------------------------- words

test("words are counted with the common ones left out", () => {
  const words = countWords([
    "Please fix the flaky test in the made-up parser",
    "the parser is broken again, fix the flaky test",
    "fix it",
    "can you look at the parser",
  ]);
  assert.equal(words.prompts, 4);
  assert.deepEqual(words.words, [
    ["fix", 3],
    ["parser", 3],
    ["flaky", 2],
    ["test", 2],
  ]);
  for (const common of ["the", "is", "in", "it", "you", "can", "please", "at"]) {
    assert.ok(!words.words.some(([w]) => w === common), common);
  }
  // Two words side by side, neither of them common. "again, fix" is cut by the comma.
  assert.deepEqual(words.phrases, [["flaky test", 2]]);
});

test("slash commands are counted apart, and paths, numbers and pasted blocks are not words", () => {
  const words = countWords([
    "/deploy staging now",
    "/deploy staging",
    "/Review",
    "/made/up/path/file.ts needs staging 2026 staging_two user@example.invalid https://example.invalid/staging",
    "[Pasted text #1 +20 lines] staging [Image #2]",
    "not a /deploy in the middle",
  ]);
  assert.deepEqual(words.commands, [
    ["/deploy", 2],
    ["/review", 1],
  ]);
  assert.deepEqual(words.words, [["staging", 4]]);
  assert.deepEqual(words.phrases, []);
});

test("nothing counted from words holds a whole prompt", () => {
  const prompt = "a made-up secret sentence nobody else typed";
  const words = countWords([prompt, prompt]);
  assert.ok(!JSON.stringify(words).includes(prompt));
  assert.ok(words.words.every(([w]) => !w.includes(" ")));
  assert.ok(words.phrases.every(([p]) => p.split(" ").length === 2));
});

// ----------------------------------------------------------------- projects

const PROJECTS = [
  ...block("2026-03-02T10:00:00Z", 3, "/home/sam/work/garden"),
  ...block("2026-03-03T10:00:00Z", 1, "/home/sam/work/garden"),
  ...block("2026-03-02T10:05:00Z", 2, "C:\\Users\\sam\\shed"),
  row("2026-03-04T10:00:00Z", "one", "/home/sam/play/garden"),
];

test("projects: hours and prompts by the folder each prompt was typed in, most hours first", () => {
  const { rows } = read(PROJECTS, UTC, "2026-03-05T12:00:00Z");
  const tokens = new Map<string, Usage>([
    ["C:\\Users\\sam\\shed", [1, 20, 300, 4]],
    ["/home/sam/quiet", [0, 5, 0, 0]],
  ]);
  const list = projectRows(rows, tokens, UTC, false);
  // Two folders end in "garden", so each also shows the part before.
  assert.deepEqual(list.map((p) => p.name), ["work/garden", "shed", "play/garden", "quiet"]);
  assert.deepEqual(list.map((p) => Math.round(p.hours * 100) / 100), [4, 2, 0.17, 0]);
  assert.deepEqual(list.map((p) => p.activeDays), [2, 1, 1, 0]);
  assert.deepEqual(list.map((p) => p.prompts), [14, 7, 1, 0]);
  assert.deepEqual(list.map((p) => [p.tokens, p.output]), [[null, null], [325, 20], [null, null], [5, 5]]);
});

test("tokens by folder come from the transcripts, for the days asked", () => {
  const { files } = usageOf(
    {
      "p/a.jsonl": [reply({ at: "2026-03-02T10:00:00Z", id: "a1", session: "a", usage: [1, 2, 3, 4] })],
      "p/b.jsonl": [reply({ at: "2026-03-09T10:00:00Z", id: "b1", session: "b", usage: [10, 20, 30, 40] })],
    },
    "2026-03-10T12:00:00Z",
  );
  assert.deepEqual([...folderTokens([files], "2026-03-01", "2026-03-10")], [["/made/up/project", [11, 22, 33, 44]]]);
  assert.deepEqual([...folderTokens([files, files], "2026-03-01", "2026-03-05")], [["/made/up/project", [1, 2, 3, 4]]]);
});

test("names hidden: every project reads Project N in order of hours, and no words are counted", () => {
  const { report, rows } = read(PROJECTS, UTC, "2026-03-05T12:00:00Z");
  const input = {
    report,
    usage: null,
    rows,
    folderTokens: new Map<string, Usage>([["/home/sam/quiet", [0, 5, 0, 0]]]),
    zone: UTC,
    now: at("2026-03-05T12:00:00Z"),
  };
  const shown = buildScreens(input);
  assert.deepEqual(shown.projects.map((p) => p.name), ["work/garden", "shed", "play/garden", "quiet"]);
  assert.ok(shown.words);

  const hidden = buildScreens({ ...input, hideNames: true });
  assert.deepEqual(hidden.projects.map((p) => p.name), ["Project 1", "Project 2", "Project 3", "Project 4"]);
  assert.deepEqual(hidden.projects.map((p) => p.hours), shown.projects.map((p) => p.hours));
  assert.equal(hidden.words, null);
  // The counts stay; only names and words go.
  assert.equal(hidden.prompts?.count, 22);
  assert.equal(hidden.prompts?.lengths?.prompts, 22);
  assert.doesNotMatch(JSON.stringify(hidden), /garden|shed|quiet|sam|Users/);
});

test("lengths and words need the text: rows from the store alone give counts and no words", () => {
  const { report, rows } = read(PROJECTS, UTC, "2026-03-05T12:00:00Z");
  const stored = rows.map(({ text: _text, ...kept }) => kept);
  const screens = buildScreens({ report, usage: null, rows: stored, folderTokens: new Map(), zone: UTC, now: at("2026-03-05T12:00:00Z") });
  assert.equal(screens.words, null);
  assert.equal(screens.prompts?.count, 22);
  assert.equal(screens.prompts?.lengths, null);
  assert.equal(screens.projects.length, 3);
  // The longest prompt is a length and a day, never the prompt.
  const withText = buildScreens({ report, usage: null, rows, folderTokens: new Map(), zone: UTC, now: at("2026-03-05T12:00:00Z") });
  assert.deepEqual(withText.prompts?.lengths?.longest, { chars: 15, day: "2026-03-02" });
});
