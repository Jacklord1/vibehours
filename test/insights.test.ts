// Made-up histories and transcripts only.
//
// Every insight rule is seen firing and seen silent, with one fixture just
// short of its margin. Every label is seen, and the order between two that
// both hold. The share picture's and the card's text is walked for names.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addDays, buildReport, mergeSources, parseRows, spansOf, type DayKey } from "../src/engine/hours";
import {
  LINES_SHOWN,
  PUBLISHED_COST,
  RULE_LIST,
  LABEL_LIST,
  cardText,
  comparison,
  firedInsights,
  formats,
  lastWeek,
  monthCards,
  pickInsights,
  styleLabel,
  weekLine,
  type Insight,
  type InsightInput,
} from "../src/engine/insights";
import { buildScreens, lateNights, mostlyOneFolder, rhythm, type ProjectRow } from "../src/engine/screens";
import { TranscriptFile, applyFiles, buildUsage, folderTokens, type Usage } from "../src/engine/transcripts";
import { costState, reply } from "./made-up";

const UTC = "UTC";
const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (iso: string) => Date.parse(iso);
const dayAt = (day: DayKey, hour: number, minute = 0) => at(`${day}T00:00:00Z`) + hour * HOUR + minute * MINUTE;
const fmt = formats("en-AU", UTC);

function row(t: number, project = "/made/up/project", display = `p ${t}`): string {
  return JSON.stringify({ display, timestamp: t, project });
}

/** A block of `hours` starting at `t`: a prompt every 20 minutes, less the 10 minute tail. */
function block(t: number, hours: number, project?: string): string[] {
  const out: string[] = [];
  const end = Math.round(t + hours * HOUR - 10 * MINUTE);
  for (let p = t; p < end; p += 20 * MINUTE) out.push(row(p, project));
  out.push(row(end, project));
  return out;
}

/** One block a day from `start`: `hours[i]` long, none for 0, beginning at `hour` o'clock. */
function daily(start: DayKey, hours: number[], hour = 19, project?: string): string[] {
  return hours.flatMap((h, i) => (h > 0 ? block(dayAt(addDays(start, i), hour), h, project) : []));
}

const fill = (n: number, value: number | ((i: number) => number)) => Array.from({ length: n }, (_, i) => (typeof value === "number" ? value : value(i)));

/** Replies from one session, every 20 minutes, so the session is live for `hours`. */
function session(name: string, t: number, hours: number, extra: Partial<Parameters<typeof reply>[0]> = {}): string[] {
  const out: string[] = [];
  const end = Math.round(t + hours * HOUR - 10 * MINUTE);
  const line = (p: number) => reply({ at: new Date(p).toISOString(), id: `${name}-${p}`, session: name, usage: [1, 10, 100, 1], ...extra });
  for (let p = t; p < end; p += 20 * MINUTE) out.push(line(p));
  out.push(line(end));
  return out;
}

/** What the app would hand the rules: the two reports, as the session makes them. */
function said(lines: string[], now: string, files: Record<string, string[]> = {}, zone = UTC): InsightInput {
  const merged = mergeSources([parseRows(lines.join("\n"))]);
  const report = buildReport(merged, { zone, now: at(now) });
  const batch = Object.entries(files).map(([path, rows]) => {
    const file = new TranscriptFile(path, rows.join("\n").length);
    for (const l of rows) file.feed(l);
    return file;
  });
  const usage = buildUsage([applyFiles({}, batch, zone).files], {
    zone,
    now: at(now),
    promptSpans: spansOf(merged.timestamps),
    promptingHours: new Map(report.days.map((d) => [d.day, d.hours])),
  });
  return { report, usage, rows: merged.rows, rhythm: rhythm(report, merged.rows, zone), late: lateNights(report, zone), zone, now: at(now), locale: "en-AU" };
}

function line(input: InsightInput, id: string): Insight | undefined {
  return firedInsights(input).find((l) => l.id === id);
}

function near(actual: unknown, expected: number, eps = 1e-6): void {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < eps, `${String(actual)} is not ${expected}`);
}

// 1 March 2026 and 1 February 2026 are Sundays.
const SUNDAY = "2026-03-01";
const endOf = (start: DayKey, days: number) => `${addDays(start, days - 1)}T23:30:00Z`;

// ------------------------------------------------------------------ weekday

test("weekday-top: one weekday clear of the next by 15%, with eight of each", () => {
  const weeks = (n: number, tuesday: number) => daily(SUNDAY, fill(n * 7, (i) => (i % 7 === 2 ? tuesday : 2)), 10);
  const fired = line(said(weeks(8, 2.4), endOf(SUNDAY, 56)), "weekday-top");
  assert.ok(fired);
  assert.equal(fired.figures.weekday, 2);
  near(fired.figures.mean, 2.4);
  near(fired.figures.nextMean, 2);
  assert.equal(
    fired.text,
    "Tuesday is your biggest day of the week: 2.4 prompting hours on an average Tuesday, against 2.0 on a Sunday, the next biggest.",
  );
  // 12.5% ahead is not 15%.
  assert.equal(line(said(weeks(8, 2.25), endOf(SUNDAY, 56)), "weekday-top"), undefined);
  // Seven weeks is not enough history, however far ahead.
  assert.equal(line(said(weeks(7, 4), endOf(SUNDAY, 49)), "weekday-top"), undefined);
});

test("weekday-quiet: one weekday 20 points under the next in days used", () => {
  const skipping = (skipped: number[]) => daily(SUNDAY, fill(56, (i) => (skipped.includes(i) ? 0 : 2)), 10);
  const fired = line(said(skipping([14, 28]), endOf(SUNDAY, 56)), "weekday-quiet");
  assert.ok(fired);
  assert.deepEqual([fired.figures.used, fired.figures.of, fired.figures.nextUsed, fired.figures.nextOf], [6, 8, 8, 8]);
  assert.equal(
    fired.text,
    "Sunday is your quietest day of the week: you used Claude Code on 6 of 8 Sundays, against 8 of 8 Mondays, the next quietest.",
  );
  // Seven of eight is 12.5 points under.
  assert.equal(line(said(skipping([14]), endOf(SUNDAY, 56)), "weekday-quiet"), undefined);
  assert.equal(line(said(skipping([]), endOf(SUNDAY, 56)), "weekday-quiet"), undefined);
});

// -------------------------------------------------------------------- month

const FEBRUARY = "2026-02-01";

test("this-month: hours a day so far against the whole months before, 20% either way", () => {
  const april = (days: number, hours: number) => said(daily(FEBRUARY, [...fill(59, 2), ...fill(days, hours)], 10), `2026-04-${String(days).padStart(2, "0")}T23:30:00Z`);
  const more = line(april(10, 2.5), "this-month");
  assert.ok(more);
  near(more.figures.hoursADayNow, 2.5);
  near(more.figures.hoursADayBefore, 2);
  assert.equal(more.figures.wholeMonths, 2);
  assert.equal(more.text, "So far in April 2026 you are averaging 2.5 prompting hours a day, more than the 2.0 a day across your 2 whole months before it.");
  assert.match(line(april(10, 1.5), "this-month")?.text ?? "", /averaging 1\.5 prompting hours a day, less than the 2\.0 a day/);
  // 15% more is not 20%.
  assert.equal(line(april(10, 2.3), "this-month"), undefined);
  // Six days of the month is not seven.
  assert.equal(line(april(6, 4), "this-month"), undefined);
  // One whole month before is not two.
  const short = said(daily("2026-03-01", [...fill(31, 2), ...fill(10, 4)], 10), "2026-04-10T23:30:00Z");
  assert.equal(line(short, "this-month"), undefined);
});

test("last-month-record: the month just ended, 10% clear of every other whole month", () => {
  const year = (march: number, start = "2026-01-01") =>
    said(daily(start, [...fill(start === "2026-01-01" ? 59 : 28, 2), ...fill(31, march), ...fill(2, 2)], 10), "2026-04-02T23:30:00Z");
  const biggest = line(year(2.3), "last-month-record");
  assert.ok(biggest);
  near(biggest.figures.hours, 71.3);
  near(biggest.figures.next, 62);
  assert.equal(biggest.text, "March 2026 was your biggest month so far: 71.3 prompting hours, against 62.0 in January 2026, the next biggest.");
  assert.equal(
    line(year(1.5), "last-month-record")?.text,
    "March 2026 was your quietest whole month so far: 46.5 prompting hours, against 56.0 in February 2026, the next quietest.",
  );
  // 65.1 hours is 5% over January's 62.
  assert.equal(line(year(2.1), "last-month-record"), undefined);
  // Two whole months is not three.
  assert.equal(line(year(2.3, FEBRUARY), "last-month-record"), undefined);
});

// -------------------------------------------------------------------- agent

/** Days with `prompting` hours typed from 8am and one session live for `live` hours from 8am. */
function agentDays(days: number, prompting: number, live: number): InsightInput {
  const lines: string[] = [];
  const files: Record<string, string[]> = {};
  for (let i = 0; i < days; i++) {
    const start = dayAt(addDays(SUNDAY, i), 8);
    lines.push(...block(start, prompting));
    files[`p/s${i}.jsonl`] = session(`s${i}`, start, live);
  }
  return said(lines, endOf(SUNDAY, days), files);
}

test("agent-ahead and agent-share: the agent's hours against yours, over the transcript period", () => {
  const ahead = agentDays(14, 1, 3);
  const fired = line(ahead, "agent-ahead");
  assert.ok(fired);
  near(fired.figures.agentHours, 28);
  near(fired.figures.yourHours, 14);
  assert.equal(fired.text, "Since 1 Mar 2026, the agent worked 28.0 hours with no prompt from you, more than the 14.0 hours you spent prompting.");
  // Both hold; one of a kind is shown, and it is the first.
  assert.ok(line(ahead, "agent-share"));
  assert.deepEqual(pickInsights(firedInsights(ahead)).filter((l) => l.kind === "agent").map((l) => l.id), ["agent-ahead"]);

  // 2.2 agent hours a day against 2 of yours is 10% ahead, not 20%.
  const share = agentDays(14, 2, 4.2);
  assert.equal(line(share, "agent-ahead"), undefined);
  assert.equal(line(share, "agent-share")?.text, "Since 1 Mar 2026, the agent kept working for 30.8 of your 58.8 session hours with no prompt from you.");

  // Half an hour in two and a half is 20%, not 25%.
  const little = agentDays(14, 2, 2.5);
  assert.equal(line(little, "agent-ahead"), undefined);
  assert.equal(line(little, "agent-share"), undefined);
  // Ten days of transcripts is not fourteen.
  assert.equal(line(agentDays(10, 1, 3), "agent-ahead"), undefined);
  assert.equal(line(agentDays(10, 1, 3), "agent-share"), undefined);
  // No transcripts at all.
  assert.equal(line(said(daily(SUNDAY, fill(14, 2)), endOf(SUNDAY, 14)), "agent-share"), undefined);
});

// --------------------------------------------------------------------- hour

/** `counts[hour]` prompts a minute apart in each named hour, every day. */
function byHour(days: number, counts: Record<number, number>): InsightInput {
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    for (const [hour, n] of Object.entries(counts)) for (let k = 0; k < n; k++) lines.push(row(dayAt(addDays(SUNDAY, i), Number(hour), k)));
  }
  return said(lines, endOf(SUNDAY, days));
}

test("hour-peak: one hour 15% clear of the next, on 500 prompts and four weeks", () => {
  const input = byHour(30, { 19: 10, 18: 8 });
  const fired = line(input, "hour-peak");
  assert.ok(fired);
  assert.deepEqual(fired.figures, { hour: 19, prompts: 300, nextHour: 18, nextPrompts: 240, total: 540 });
  assert.equal(
    fired.text,
    `Your busiest hour of the day starts at ${fmt.hour(19)}: 300 of your 540 prompts were typed in it, against 240 in the hour from ${fmt.hour(18)}, the next busiest.`,
  );
  // The part of the day holds too, and only the first of the kind is shown.
  assert.ok(line(input, "day-part"));
  assert.deepEqual(pickInsights(firedInsights(input)).filter((l) => l.kind === "hour").map((l) => l.id), ["hour-peak"]);
  // 270 against 240 is 12.5% ahead.
  assert.equal(line(byHour(30, { 19: 9, 18: 8 }), "hour-peak"), undefined);
  // 486 prompts over 27 days is neither 500 nor four weeks.
  assert.equal(line(byHour(27, { 19: 10, 18: 8 }), "hour-peak"), undefined);
});

test("day-part: one part of the day 25% clear of the next", () => {
  const fired = line(byHour(30, { 9: 10, 14: 8 }), "day-part");
  assert.ok(fired);
  assert.deepEqual(fired.figures, { part: "in the morning", prompts: 300, nextPart: "in the afternoon", nextPrompts: 240, total: 540 });
  assert.equal(
    fired.text,
    `More of your prompts are typed in the morning than in any other part of the day: 300 of 540 between ${fmt.hour(6)} and ${fmt.hour(12)}, against 240 in the afternoon.`,
  );
  // 270 against 240 is 12.5% ahead.
  assert.equal(line(byHour(30, { 9: 9, 14: 8 }), "day-part"), undefined);
  assert.equal(line(byHour(27, { 9: 10, 14: 8 }), "day-part"), undefined);
});

// ------------------------------------------------------------------ streaks

test("streak-now: seven days in a row and still going", () => {
  const fired = line(said(daily(SUNDAY, fill(7, 2)), endOf(SUNDAY, 7)), "streak-now");
  assert.equal(fired?.text, "You have used Claude Code 7 days in a row, up to today. That is your longest run so far.");
  assert.equal(line(said(daily(SUNDAY, fill(6, 2)), endOf(SUNDAY, 6)), "streak-now"), undefined);
  // An empty today does not break the run, and the line says where it ends.
  assert.match(line(said(daily(SUNDAY, fill(7, 2)), "2026-03-08T12:00:00Z"), "streak-now")?.text ?? "", /7 days in a row, up to yesterday\./);
  // An empty yesterday does.
  assert.equal(line(said(daily(SUNDAY, fill(7, 2)), "2026-03-09T12:00:00Z"), "streak-now"), undefined);
  // A longer run earlier is named, and this one is not called the longest.
  const second = said(daily(SUNDAY, [...fill(10, 2), 0, 0, ...fill(7, 2)]), endOf(SUNDAY, 19));
  assert.equal(line(second, "streak-now")?.text, "You have used Claude Code 7 days in a row, up to today. Your longest run is 10 days, 1 Mar to 10 Mar 2026.");
});

test("longest-break: seven days off, on eight weeks of history", () => {
  const off = (days: number, skipped: number[]) => said(daily(SUNDAY, fill(days, (i) => (skipped.includes(i) ? 0 : 2))), endOf(SUNDAY, days));
  const week = [20, 21, 22, 23, 24, 25, 26];
  const fired = line(off(56, week), "longest-break");
  assert.deepEqual(fired?.figures, { days: 7, daysOff: 7, totalDays: 56 });
  assert.equal(fired?.text, "Your longest break is 7 days, 21 Mar to 27 Mar 2026. 7 of your 56 days of history have no prompt.");
  // Six days is not seven, and seven weeks is not eight.
  assert.equal(line(off(56, week.slice(1)), "longest-break"), undefined);
  assert.equal(line(off(49, week), "longest-break"), undefined);
  // It is the last thing said: every other kind comes before it.
  assert.equal(RULE_LIST[RULE_LIST.length - 1].id, "longest-break");
  assert.equal(RULE_LIST.filter((r) => r.kind === "break").length, 1);
});

// ------------------------------------------------------------------ at once

function atOnce(days: number, doubled: number[]): InsightInput {
  const lines: string[] = [];
  const files: Record<string, string[]> = {};
  for (let i = 0; i < days; i++) {
    const start = dayAt(addDays(SUNDAY, i), 18);
    lines.push(...block(start, 3));
    files[`p/a${i}.jsonl`] = session(`a${i}`, start, 1);
    if (doubled.includes(i)) files[`p/b${i}.jsonl`] = session(`b${i}`, start + 20 * MINUTE, 0.5);
  }
  return said(lines, endOf(SUNDAY, days), files);
}

test("at-once: two sessions live at once on a quarter of the days with a session", () => {
  const fired = line(atOnce(7, [0, 1]), "at-once");
  assert.ok(fired);
  assert.deepEqual([fired.figures.daysWithTwo, fired.figures.daysWithSession, fired.figures.most], [2, 7, 2]);
  assert.equal(
    fired.text,
    "Since 1 Mar 2026, you had two or more sessions live at once on 2 of 7 days with a session. The most at one moment was 2, on 1 Mar 2026.",
  );
  // One day in seven is 14%.
  assert.equal(line(atOnce(7, [0]), "at-once"), undefined);
  // Six days with a session is not seven.
  assert.equal(line(atOnce(6, [0, 1, 2]), "at-once"), undefined);
});

// ----------------------------------------------------------------- big days

test("big-run: three big days in a row", () => {
  assert.equal(
    line(said(daily(SUNDAY, [4, 4, 4], 10), endOf(SUNDAY, 3)), "big-run")?.text,
    "Your longest run of big days is 3 in a row, 1 Mar to 3 Mar 2026. A big day is 4 prompting hours or more.",
  );
  assert.equal(line(said(daily(SUNDAY, [4, 4, 3.9], 10), endOf(SUNDAY, 3)), "big-run"), undefined);
});

test("big-share: a quarter of the days used are big days", () => {
  const big = (n: number) => said(daily(SUNDAY, fill(28, (i) => (i % 4 === 0 && i / 4 < n ? 4 : 1)), 10), endOf(SUNDAY, 28));
  const fired = line(big(7), "big-share");
  assert.deepEqual([fired?.figures.bigDays, fired?.figures.activeDays], [7, 28]);
  assert.equal(fired?.text, "7 of your 28 days used were big days of 4 prompting hours or more, and half of those ran 4.0 hours or longer.");
  // Six of 28 is 21%.
  assert.equal(line(big(6), "big-share"), undefined);
  // 27 days of history is not four weeks.
  assert.equal(line(said(daily(SUNDAY, fill(27, 4), 10), endOf(SUNDAY, 27)), "big-share"), undefined);
});

// ------------------------------------------------------------- busiest week

test("busiest-week-clear: the busiest week 25% clear of the next, on eight weeks", () => {
  const weeks = (n: number, third: number) => said(daily(SUNDAY, fill(n * 7, (i) => (i >= 14 && i < 21 ? third : 2)), 10), endOf(SUNDAY, n * 7));
  const fired = line(weeks(8, 2.5), "busiest-week-clear");
  assert.ok(fired);
  near(fired.figures.hours, 17.5);
  near(fired.figures.next, 14);
  assert.equal(fired.text, "Your busiest week was the week of 15 Mar 2026: 17.5 prompting hours, against 14.0 in the next busiest.");
  // 16.8 hours is 20% over 14.
  assert.equal(line(weeks(8, 2.4), "busiest-week-clear"), undefined);
  assert.equal(line(weeks(7, 4), "busiest-week-clear"), undefined);
});

test("busiest-week-average: the busiest week at twice an average whole week", () => {
  // Nine whole weeks, read on the Sunday after.
  const weeks = (third: number) => said(daily(SUNDAY, fill(63, (i) => (i >= 14 && i < 21 ? third : 2)), 10), "2026-05-03T12:00:00Z");
  const fired = line(weeks(4.6), "busiest-week-average");
  assert.ok(fired);
  assert.equal(fired.figures.wholeWeeks, 9);
  near(fired.figures.hours, 32.2);
  near(fired.figures.average, (8 * 14 + 32.2) / 9);
  assert.equal(fired.text, "Your busiest week was the week of 15 Mar 2026: 32.2 prompting hours, against 16.0 in an average week.");
  // 31.5 hours against an average of 15.94 is 1.98 times.
  assert.equal(line(weeks(4.5), "busiest-week-average"), undefined);
  // Seven whole weeks is not eight.
  const short = said(daily(SUNDAY, fill(49, (i) => (i < 7 ? 8 : 1)), 10), "2026-04-19T12:00:00Z");
  assert.equal(line(short, "busiest-week-average"), undefined);
});

// -------------------------------------------------------------- late nights

function lateDays(days: number, late: number): InsightInput {
  const lines = daily(SUNDAY, fill(days, 1));
  // 11pm to ten to one the next morning.
  for (let i = 0; i < late; i++) lines.push(...block(dayAt(addDays(SUNDAY, i * 2), 23), 2));
  return said(lines, endOf(SUNDAY, days));
}

test("late-nights: five days past midnight, and a tenth of the days used", () => {
  const fired = line(lateDays(28, 5), "late-nights");
  assert.ok(fired);
  assert.deepEqual(fired.figures, { pastMidnight: 5, activeDays: 28, latestDay: "2026-03-01" });
  assert.equal(
    fired.text,
    `5 of your 28 days used ran past midnight. The latest finish was ${fmt.time(dayAt("2026-03-02", 0, 50))}, on the night of 1 Mar 2026.`,
  );
  assert.equal(line(lateDays(28, 4), "late-nights"), undefined);
  // Five of 60 is 8%.
  assert.equal(line(lateDays(60, 5), "late-nights"), undefined);
});

// ---------------------------------------------------------- tools and models

function withReplies(...replies: string[]): InsightInput {
  return said([row(dayAt(SUNDAY, 10))], endOf(SUNDAY, 1), { "p/a.jsonl": replies });
}

const tools = (counts: Record<string, number>) => Object.entries(counts).flatMap(([name, n]) => fill(n, 0).map(() => name));

test("top-tool: the most used tool 25% clear of the next, on 200 uses", () => {
  const one = (counts: Record<string, number>) => withReplies(reply({ at: "2026-03-01T10:00:00Z", id: "a1", tools: tools(counts) }));
  const fired = line(one({ Bash: 125, Read: 100 }), "top-tool");
  assert.deepEqual(fired?.figures, { tool: "Bash", uses: 125, nextTool: "Read", nextUses: 100, total: 225, from: "2026-03-01" });
  assert.equal(fired?.text, "Since 1 Mar 2026, the tool the agent used most is Bash: 125 of 225 tool uses, against 100 for Read, the next.");
  // 120 against 100 is 20% ahead.
  assert.equal(line(one({ Bash: 120, Read: 100 }), "top-tool"), undefined);
  // 150 uses is not 200.
  assert.equal(line(one({ Bash: 100, Read: 50 }), "top-tool"), undefined);
  // One tool leads nothing.
  assert.equal(line(one({ Bash: 300 }), "top-tool"), undefined);
  // The tools that reach other services are one tool, and no server is named.
  const mcp = line(one({ mcp__garden__water: 80, mcp__shed__count: 70, Read: 100 }), "top-tool");
  assert.match(mcp?.text ?? "", /most is MCP tools: 150 of 250 tool uses, against 100 for Read/);
  assert.doesNotMatch(mcp?.text ?? "", /garden|shed/);
});

test("top-model: one model with 60% of the output tokens, on 100,000 of them", () => {
  const two = (a: number, b: number) =>
    withReplies(
      reply({ at: "2026-03-01T10:00:00Z", id: "a1", model: "claude-made-up-large", usage: [1, a, 0, 0] }),
      reply({ at: "2026-03-01T10:05:00Z", id: "a2", model: "claude-made-up-small", usage: [1, b, 0, 0] }),
    );
  const fired = line(two(61_000, 39_000), "top-model");
  assert.deepEqual(fired?.figures, {
    model: "claude-made-up-large",
    output: 61_000,
    nextModel: "claude-made-up-small",
    nextOutput: 39_000,
    total: 100_000,
    from: "2026-03-01",
  });
  assert.equal(
    fired?.text,
    `Since 1 Mar 2026, claude-made-up-large wrote ${fmt.big(61_000)} of your ${fmt.big(100_000)} output tokens, against ${fmt.big(39_000)} from claude-made-up-small, the next.`,
  );
  // 59% is not 60%.
  assert.equal(line(two(59_000, 41_000), "top-model"), undefined);
  // 10,000 output tokens is not 100,000.
  assert.equal(line(two(6_100, 3_900), "top-model"), undefined);
  // One model leads nothing.
  assert.equal(line(withReplies(reply({ at: "2026-03-01T10:00:00Z", id: "a1", usage: [1, 200_000, 0, 0] })), "top-model"), undefined);
});

// ------------------------------------------------------------ the lines shown

test("every rule is covered here, and nothing is said with no history", () => {
  assert.deepEqual(
    RULE_LIST.map((r) => r.id),
    [
      "this-month",
      "last-month-record",
      "weekday-top",
      "weekday-quiet",
      "agent-ahead",
      "agent-share",
      "hour-peak",
      "day-part",
      "streak-now",
      "at-once",
      "big-run",
      "big-share",
      "busiest-week-clear",
      "busiest-week-average",
      "late-nights",
      "top-tool",
      "top-model",
      "longest-break",
    ],
  );
  for (const rule of RULE_LIST) assert.ok(rule.needs && rule.when, rule.id);
  const empty = { report: null, usage: null, rows: [], rhythm: null, late: null, zone: UTC, now: at("2026-03-01T12:00:00Z") };
  assert.deepEqual(firedInsights(empty), []);
  assert.equal(styleLabel(empty), null);
  assert.deepEqual(monthCards(empty), []);
});

test("the lines shown are the first of each kind in a fixed order, four at most, the same every time", () => {
  const made = (id: string, kind: Insight["kind"]): Insight => ({ id, kind, text: id, figures: {} });
  const fired = [made("a", "month"), made("b", "month"), made("c", "weekday"), made("d", "agent"), made("e", "agent"), made("f", "hour"), made("g", "streak")];
  assert.equal(LINES_SHOWN, 4);
  assert.deepEqual(pickInsights(fired).map((l) => l.id), ["a", "c", "d", "f"]);
  // The same numbers give the same lines, in the same words.
  const again = () => pickInsights(firedInsights(agentDays(14, 1, 3)));
  assert.deepEqual(again(), again());
  // No line gives advice, praise or a target.
  const everything = [agentDays(14, 1, 3), byHour(30, { 19: 10, 18: 8 }), lateDays(28, 5), atOnce(7, [0, 1])].flatMap(firedInsights);
  assert.ok(everything.length >= 6);
  for (const l of everything) assert.doesNotMatch(l.text, /\b(should|try|well done|great|good|nice|keep it up|goal|target|aim)\b/i, l.id);
});

// ---------------------------------------------------------------- the label

const labelOf = (input: InsightInput) => styleLabel(input)?.id ?? null;

test("no label under four weeks of history", () => {
  assert.equal(styleLabel(said(daily(SUNDAY, fill(27, 5), 18), endOf(SUNDAY, 27))), null);
  assert.equal(labelOf(said(daily(SUNDAY, fill(28, 5), 18), endOf(SUNDAY, 28))), "long-hauler");
});

/** Four weeks of an hour a day at 7pm, with a prompt at 11.10pm on `late` days and at 5am on `early` days. */
function owlOrBird(late: number, early: number): InsightInput {
  const lines = daily(SUNDAY, fill(28, 1));
  for (let i = 0; i < late; i++) lines.push(row(dayAt(addDays(SUNDAY, i), 23, 10)));
  for (let i = 0; i < early; i++) lines.push(row(dayAt(addDays(SUNDAY, 27 - i), 5)));
  return said(lines, endOf(SUNDAY, 28));
}

test("each label has its rule, and the first that holds wins", () => {
  // Late at night: 9 of 28 days is 32%; 8 is 29%.
  assert.deepEqual(styleLabel(owlOrBird(9, 0)), { id: "night-owl", name: "Night owl", why: `9 of your 28 days used finished after ${fmt.hour(23)}.` });
  assert.notEqual(labelOf(owlOrBird(8, 0)), "night-owl");
  // Early in the day.
  assert.deepEqual(styleLabel(owlOrBird(0, 9)), { id: "early-bird", name: "Early bird", why: `9 of your 28 days used started before ${fmt.hour(7)}.` });
  assert.notEqual(labelOf(owlOrBird(0, 8)), "early-bird");
  // Both hold: late at night comes first.
  assert.equal(labelOf(owlOrBird(9, 9)), "night-owl");

  // Weekends: 16 of 36 hours.
  const weekender = said(daily(SUNDAY, fill(28, (i) => (i % 7 === 0 || i % 7 === 6 ? 2 : 1)), 10), endOf(SUNDAY, 28));
  assert.deepEqual(styleLabel(weekender), { id: "weekender", name: "Weekender", why: "16 of your 36 prompting hours fell on a Saturday or Sunday." });

  // Weekday daytime: Monday to Friday from 10am, read on the fourth Sunday.
  const office = said(daily("2026-03-02", fill(26, (i) => (i % 7 < 5 ? 2 : 0)), 10), "2026-03-29T12:00:00Z");
  assert.deepEqual(styleLabel(office), {
    id: "office-hours",
    name: "Office hours",
    why: `140 of your 140 prompts were typed on a weekday between ${fmt.hour(8)} and ${fmt.hour(18)}.`,
  });
  // The same hours in the evening are not office hours.
  assert.notEqual(labelOf(said(daily("2026-03-02", fill(26, (i) => (i % 7 < 5 ? 2 : 0)), 19), "2026-03-29T12:00:00Z")), "office-hours");

  // Long days: 12 of 28 is 43%; 11 is 39%.
  const long = (big: number) => said(daily(SUNDAY, fill(28, (i) => (i < big ? 4 : 3)), 18), endOf(SUNDAY, 28));
  assert.deepEqual(styleLabel(long(12)), { id: "long-hauler", name: "Long-hauler", why: "12 of your 28 days used ran 4 prompting hours or more." });
  assert.notEqual(labelOf(long(11)), "long-hauler");

  // Many short days. Nearly every day holds too, and comes after.
  assert.deepEqual(styleLabel(said(daily(SUNDAY, fill(28, 1)), endOf(SUNDAY, 28))), {
    id: "little-and-often",
    name: "Little and often",
    why: "You use it 7.0 days a week, and half your days are under 1.0 prompting hours.",
  });

  // Nearly every day: three hours every evening.
  assert.deepEqual(styleLabel(long(0)), { id: "daily-regular", name: "Daily regular", why: "You used Claude Code on 28 of 28 days." });

  // Several sessions at once: five days a week, with two sessions on half the days a session ran.
  const juggling = (doubled: number) => {
    const used = fill(28, (i) => (i % 7 < 5 ? 3 : 0));
    const files: Record<string, string[]> = {};
    let withSession = 0;
    used.forEach((hours, i) => {
      if (!hours || withSession >= 14) return;
      const start = dayAt(addDays(SUNDAY, i), 18);
      files[`p/a${i}.jsonl`] = session(`a${i}`, start, 1);
      if (withSession < doubled) files[`p/b${i}.jsonl`] = session(`b${i}`, start + 20 * MINUTE, 0.5);
      withSession++;
    });
    return said(daily(SUNDAY, used, 18), endOf(SUNDAY, 28), files);
  };
  assert.deepEqual(styleLabel(juggling(7)), {
    id: "juggler",
    name: "Juggler",
    why: "Since 1 Mar 2026, two or more sessions were live at once on 7 of 14 days with a session.",
  });
  // And the plain one, when none holds: six of fourteen is 43%.
  assert.deepEqual(styleLabel(juggling(6)), { id: "vibe-coder", name: "Vibe coder", why: "No one habit stands out in your 28 days of history." });

  assert.deepEqual(
    LABEL_LIST.map((l) => l.id),
    ["night-owl", "early-bird", "weekender", "office-hours", "long-hauler", "little-and-often", "daily-regular", "juggler", "vibe-coder"],
  );
});

// ----------------------------------------------------------- the comparison

test("the comparison: list-price value per active day, with a cost and without one", () => {
  const replies = [
    reply({ at: "2026-03-01T10:00:00Z", id: "a1", session: "a" }),
    reply({ at: "2026-03-03T10:00:00Z", id: "a2", session: "a" }),
  ];
  const withCost = comparison(said([row(dayAt(SUNDAY, 10))], "2026-03-04T12:00:00Z", { "p/a.jsonl": [...replies, costState("a", 1, 12.5)] }).usage);
  // Two days with a reply, of the four the transcripts cover.
  assert.deepEqual(
    [withCost?.activeDays, withCost?.cost, withCost?.perActiveDay, withCost?.from, withCost?.to],
    [2, 12.5, 6.25, "2026-03-01", "2026-03-04"],
  );
  const without = comparison(said([row(dayAt(SUNDAY, 10))], "2026-03-04T12:00:00Z", { "p/a.jsonl": replies }).usage);
  assert.deepEqual([without?.activeDays, without?.cost, without?.perActiveDay], [2, null, null]);
  // No transcripts: nothing to compare.
  assert.equal(comparison(null), null);

  // The published figure carries its source, and the day it was read.
  assert.equal(withCost?.published, PUBLISHED_COST);
  assert.deepEqual([PUBLISHED_COST.average, PUBLISHED_COST.ninetyPercentUnder], [13, 30]);
  assert.match(PUBLISHED_COST.url, /^https:\/\//);
  assert.match(PUBLISHED_COST.readOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(PUBLISHED_COST.quote, /enterprise deployments.*\$13 per developer per active day.*\$30 per active day for 90% of users/);
});

// ---------------------------------------------------------------- last week

const TWO_WEEKS = [
  ...block(at("2026-02-16T10:00:00Z"), 2),
  // Last week: Sunday 1 h, Saturday 3 h.
  ...block(at("2026-02-22T10:00:00Z"), 1),
  ...block(at("2026-02-28T10:00:00Z"), 3),
];

test("last week in one line: days used, hours and the biggest day, for the week just ended", () => {
  const report = said(TWO_WEEKS, "2026-03-01T12:00:00Z").report;
  const last = lastWeek(report, at("2026-03-01T12:00:00Z"), "en-AU");
  assert.ok(last);
  assert.deepEqual([last.from, last.to, last.activeDays, last.biggest?.day], ["2026-02-22", "2026-02-28", 2, "2026-02-28"]);
  near(last.hours, 4);
  assert.equal(last.text, "Last week, 22 Feb to 28 Feb 2026: 2 days used, 4.0 prompting hours, the biggest Saturday 28 Feb at 3.0 hours.");

  // On the Saturday the week just ended is the one before.
  const saturday = said(TWO_WEEKS, "2026-02-28T23:00:00Z").report;
  assert.deepEqual(
    [lastWeek(saturday, at("2026-02-28T23:00:00Z"), "en-AU")?.from, lastWeek(saturday, at("2026-02-28T23:00:00Z"), "en-AU")?.hours],
    ["2026-02-16", 2],
  );

  // A week with no use says so.
  const quiet = said([...block(at("2026-02-16T10:00:00Z"), 2), row(at("2026-03-01T10:00:00Z"))], "2026-03-01T12:00:00Z").report;
  const none = lastWeek(quiet, at("2026-03-01T12:00:00Z"), "en-AU");
  assert.deepEqual([none?.activeDays, none?.hours, none?.biggest], [0, 0, null]);
  assert.equal(none?.text, "Last week, 22 Feb to 28 Feb 2026: you did not use Claude Code.");

  // A history that began this week has no last week, and neither has no history.
  const fresh = said([row(at("2026-03-01T10:00:00Z"))], "2026-03-02T12:00:00Z").report;
  assert.equal(lastWeek(fresh, at("2026-03-02T12:00:00Z"), "en-AU"), null);
  assert.equal(lastWeek(null, at("2026-03-02T12:00:00Z"), "en-AU"), null);
});

test("the weekly line comes up on the first open of a new week, stays closed once closed, and never on a first-ever open", () => {
  const monday = at("2026-02-23T09:00:00Z");
  // A first-ever open is remembered as closed.
  const first = weekLine(undefined, monday, UTC, true);
  assert.deepEqual(first, { week: "2026-02-22", closed: true });
  // Opened again the same week: still closed, and nothing to save.
  assert.equal(weekLine(first, at("2026-02-28T23:00:00Z"), UTC, false), first);
  // Across a Sunday it comes up.
  const sunday = weekLine(first, at("2026-03-01T09:00:00Z"), UTC, false);
  assert.deepEqual(sunday, { week: "2026-03-01", closed: false });
  // It stays up until it is closed, then stays closed for the week.
  assert.equal(weekLine(sunday, at("2026-03-03T09:00:00Z"), UTC, false), sunday);
  const closed = { ...sunday, closed: true };
  assert.equal(weekLine(closed, at("2026-03-07T23:00:00Z"), UTC, false), closed);
  assert.deepEqual(weekLine(closed, at("2026-03-08T09:00:00Z"), UTC, false), { week: "2026-03-08", closed: false });
  // An app that was set up before the line existed has nothing remembered: it comes up.
  assert.deepEqual(weekLine(undefined, monday, UTC, false), { week: "2026-02-22", closed: false });
  // Before 4am on a Sunday it is still Saturday's week. Brisbane is UTC+10.
  assert.equal(weekLine(closed, at("2026-03-07T17:30:00Z"), "Australia/Brisbane", false), closed);
  assert.deepEqual(weekLine(closed, at("2026-03-07T18:30:00Z"), "Australia/Brisbane", false), { week: "2026-03-08", closed: false });
});

// ------------------------------------------------- the picture and the card

/** A user with names worth hiding: two project folders, a transcript, made-up words. */
function named(hideNames: boolean) {
  const lines = [
    ...daily(FEBRUARY, fill(28, 2), 10, "/home/sam/work/garden"),
    ...daily("2026-03-01", fill(31, (i) => (i % 2 ? 0 : 5)), 10, "C:\\Users\\sam\\shed"),
    row(at("2026-04-02T10:00:00Z"), "/srv/attic.invalid/loft", "water the zucchini trellis"),
  ];
  const input = said(lines, "2026-04-02T23:30:00Z", {
    "/home/sam/.claude/projects/-home-sam-work-garden/a.jsonl": [
      // The transcripts reach back to the first of April and no further.
      ...session("z", at("2026-04-01T10:00:00Z"), 1 / 6),
      ...session("a", at("2026-04-02T10:00:00Z"), 1, { tools: ["Bash", "mcp__attic__lookup"] }),
      costState("a", 1, 12.5),
    ],
  });
  const tokens = new Map<string, Usage>([["/home/sam/work/garden", [1, 2, 3, 4]]]);
  return buildScreens({ report: input.report, usage: input.usage, rows: input.rows, folderTokens: tokens, zone: UTC, now: input.now, hideNames, locale: "en-AU" });
}

const NAMES = /garden|shed|sam\b|attic|loft|zucchini|trellis|water|invalid|claude-made-up|made.up|\.jsonl|[\\/]/i;

test("the share picture and every card: no project, source, host or path, and none of the user's words", () => {
  for (const hide of [false, true]) {
    const screens = named(hide);
    assert.ok(screens.share);
    assert.equal(screens.months.length, 3);
    for (const card of [screens.share, ...screens.months.map((m) => m.card)]) {
      for (const text of cardText(card)) assert.doesNotMatch(text, NAMES, text);
      // And nothing else on the card object carries one either.
      assert.doesNotMatch(JSON.stringify(card), NAMES);
    }
  }
  // The names are in the fixture: with names shown the projects list has them.
  assert.match(JSON.stringify(named(false).projects), /garden/);
});

test("the share picture: the app's name, the period, the label and six figures, each with its measure", () => {
  const share = named(false).share;
  assert.ok(share);
  assert.equal(share.name, "Vibehours");
  assert.equal(share.period, "1 Feb to 2 Apr 2026, 61 days");
  // The label and its line head the picture.
  assert.deepEqual([share.heading, share.sub], ["Vibe coder", "No one habit stands out in your 61 days of history."]);
  assert.equal(share.figures.length, 6);
  for (const f of share.figures) assert.ok(f.value !== "" && f.measure.length > 10, f.measure);
  // The app has two kinds of hours, so a figure in hours says which.
  for (const f of share.figures.filter((x) => /\bh\b/.test(x.unit))) assert.match(f.measure, /prompting hours|session hours/i, f.measure);
  assert.deepEqual(share.figures.map((f) => f.unit), ["days a week", "h a week", "h", "days", "h", "tokens"]);
  // The year in squares: one a day, the days before the history marked as such.
  assert.equal(share.squares.length, 365);
  assert.equal(share.squares.filter((s) => !s.out).length, 61);
  assert.deepEqual(share.squares.find((s) => s.day === "2026-03-01"), { day: "2026-03-01", level: 3, out: false });
  assert.equal(share.squaresKey.length, 5);

  // With no transcripts, the two transcript figures give way to two from the history.
  const lines = daily(FEBRUARY, fill(28, 2), 10);
  const plain = said(lines, endOf(FEBRUARY, 28));
  const without = buildScreens({ report: plain.report, usage: null, rows: plain.rows, folderTokens: new Map(), zone: UTC, now: plain.now, locale: "en-AU" }).share;
  assert.deepEqual(without?.figures.map((f) => f.unit), ["days a week", "h a week", "h", "days", "big days", "prompts"]);
  // No history, no picture.
  assert.equal(buildScreens({ report: null, usage: null, rows: [], folderTokens: new Map(), zone: UTC, now: plain.now }).share, null);
});

test("the monthly card: that month's days, hours, biggest day, busiest weekday, tokens where covered, and one line true of it", () => {
  const cards = named(false).months;
  assert.deepEqual(cards.map((m) => [m.month, m.name]), [["2026-04", "April 2026"], ["2026-03", "March 2026"], ["2026-02", "February 2026"]]);

  const march = cards[1].card;
  assert.deepEqual([march.heading, march.period], ["March 2026", "1 Mar to 31 Mar 2026, 31 days"]);
  assert.deepEqual(march.figures.slice(0, 3), [
    { value: "16", unit: "of 31 days", measure: "Days with a prompt" },
    { value: "80.0", unit: "h", measure: "Prompting hours: time spent typing prompts" },
    { value: "5.0", unit: "h", measure: "Biggest day, in prompting hours: 1 Mar" },
  ]);
  // Sunday and Tuesday both had three five-hour days: no weekday is clear of the next, so none is named.
  assert.equal(march.figures.length, 3);
  // The transcripts do not reach back to March, so it has no tokens.
  assert.ok(!march.figures.some((f) => f.unit === "tokens"));
  // Two whole months is too few to call one the biggest, so the line is the next that is true.
  assert.equal(march.line, "16 of the 16 days you used were big days of 4 prompting hours or more.");
  assert.equal(march.squares.length, 31);

  // February: used every day.
  assert.equal(cards[2].card.line, "You used Claude Code on every day of the month.");

  // April so far: two days in, one used, and covered by the transcripts.
  const april = cards[0].card;
  assert.equal(april.period, "1 Apr to 2 Apr 2026, 2 days, the month so far");
  assert.deepEqual(april.figures[0], { value: "1", unit: "of 2 days", measure: "Days with a prompt" });
  assert.deepEqual(april.figures[april.figures.length - 1], { value: "560", unit: "tokens", measure: "Every token, cache reads included" });
  // Two days is not enough of a month to name a busiest weekday.
  assert.ok(!april.figures.some((f) => f.measure.startsWith("Busiest weekday")));
  assert.equal(april.line, null);
  // The days of April still to come are no data, not no hours.
  assert.deepEqual([april.squares.length, april.squares.filter((s) => s.out).length], [30, 28]);
});

test("the monthly card: a busiest weekday needs to be clear of the next, and a month with no use has no card", () => {
  // March, with Tuesdays at 3 h and every other day at 2 h: five Tuesdays, 15 h against 10 h on a Sunday.
  const tuesdays = said(daily("2026-03-01", fill(31, (i) => (i % 7 === 2 ? 3 : 2)), 10), "2026-03-31T23:30:00Z");
  const card = monthCards(tuesdays)[0].card;
  assert.deepEqual(card.figures[3], { value: "Tuesday", unit: "", measure: "Busiest weekday: 15.0 prompting hours over 5 Tuesdays" });
  // Seven days in a row or more, and not every day of a whole month: the run is the line.
  assert.equal(card.line, "Your longest run in the month was 31 days in a row, 1 Mar to 31 Mar 2026.");
  // Sunday, Monday and Tuesday each come five times in March at the same hours: none leads.
  const level = said(daily("2026-03-01", fill(31, 2), 10), "2026-03-31T23:30:00Z");
  assert.ok(!monthCards(level)[0].card.figures.some((f) => f.measure.startsWith("Busiest weekday")));

  // With three whole months, one 10% clear of the others is the biggest so far.
  const three = said(daily("2026-01-01", [...fill(59, 2), ...fill(31, 2.3), ...fill(2, 2)], 10), "2026-04-02T23:30:00Z");
  assert.equal(monthCards(three)[1].card.line, "Your biggest month so far: 71.3 prompting hours, against 62.0 in January 2026, the next biggest.");
  assert.equal(monthCards(three)[2].card.line, "You used Claude Code on every day of the month.");

  // January and March used, February not: two cards.
  const gap = said([...daily("2026-01-01", fill(31, 2), 10), ...daily("2026-03-01", fill(3, 2), 10)], "2026-03-03T23:30:00Z");
  assert.deepEqual(monthCards(gap).map((m) => m.month), ["2026-03", "2026-01"]);
  // Big days and late nights are lines of their own.
  const big = said(daily("2026-03-01", fill(31, (i) => (i % 3 === 0 && i < 12 ? 4 : i % 3 === 1 ? 1 : 0)), 10), "2026-03-31T23:30:00Z");
  assert.equal(monthCards(big)[0].card.line, "4 of the 14 days you used were big days of 4 prompting hours or more.");
  const late = monthCards(lateDays(28, 3))[0].card;
  assert.equal(late.line, "Your longest run in the month was 28 days in a row, 1 Mar to 28 Mar 2026.");
  const lateOnly = said(
    [0, 3, 6].flatMap((i) => block(dayAt(addDays(SUNDAY, i), 23), 2)),
    endOf(SUNDAY, 8),
  );
  assert.equal(monthCards(lateOnly)[0].card.line, "3 of the 3 days you used ran past midnight.");
});

// ----------------------------------------------------- projects, one folder

test("one folder holding over 80% of the project hours is said; 80% or less is not", () => {
  const rows = (...hours: number[]): ProjectRow[] => hours.map((h, i) => ({ name: `Project ${i + 1}`, hours: h, activeDays: 1, prompts: 1, tokens: null, output: null }));
  assert.deepEqual(mostlyOneFolder(rows(81, 10, 9)), { hours: 81, of: 100 });
  assert.equal(mostlyOneFolder(rows(80, 10, 10)), null);
  // One project is not a split at all, and no hours is nothing to say.
  assert.equal(mostlyOneFolder(rows(5)), null);
  assert.equal(mostlyOneFolder(rows(0, 0)), null);
  assert.equal(mostlyOneFolder([]), null);
  // And it reaches the page.
  assert.deepEqual(named(false).oneFolder, null);
  assert.equal(folderTokens([], "2026-01-01", "2026-01-02").size, 0);
});

// ------------------------------------------------- the picture, on a phone

test("nothing on a picture or a card is set under 22 px of 630", () => {
  // The drawing needs a canvas, which no test has. Its sizes are one table,
  // read here from the source: every one is 22 or more, and no size is
  // written anywhere else in the file.
  const source = readFileSync(join(process.cwd(), "src", "renderer", "card.ts"), "utf8");
  const table = /const CARD_PX = \{([^}]+)\}/.exec(source)?.[1] ?? "";
  const sizes = [...table.matchAll(/(\w+): (\d+)/g)].map((m) => ({ name: m[1], px: Number(m[2]) }));
  assert.ok(sizes.length >= 10);
  for (const s of sizes) assert.ok(s.px >= 22, `${s.name} is ${s.px}`);
  assert.equal(sizes.find((s) => s.name === "least")?.px, 22);
  assert.doesNotMatch(source, /font\(\d/);
  assert.doesNotMatch(source, /fitted\([^,]+, \d/);
});
