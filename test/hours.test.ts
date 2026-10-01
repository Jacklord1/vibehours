// Every fixture here is made up. No real history is ever used in a test.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeDays,
  addDays,
  buildReport,
  dayKeyer,
  mergeSources,
  parseHistory,
  parseRows,
  reportFromText,
  weekStart,
  type Headline,
} from "../src/engine/hours";

const UTC = "UTC";

/** One history line. `at` is an ISO time with its offset. */
function row(at: string, display = "make the button blue"): string {
  return JSON.stringify({ display, timestamp: Date.parse(at), project: "/made/up", pastedContents: {} });
}

function file(...rows: string[]): string {
  return rows.join("\n") + "\n";
}

function near(actual: number | null, expected: number, eps = 1e-9): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < eps, `${actual} is not ${expected}`);
}

function headlineOf(text: string, opts: { zone?: string; from?: string; to?: string; now?: number } = {}): Headline {
  const report = reportFromText(text, { zone: UTC, ...opts });
  assert.ok(report.headline);
  return report.headline;
}

test("a gap of exactly 30 minutes stays one block", () => {
  const report = reportFromText(file(row("2026-03-02T10:00:00Z"), row("2026-03-02T10:30:00Z")), { zone: UTC });
  assert.equal(report.days.length, 1);
  assert.equal(report.days[0].blocks, 1);
  near(report.days[0].hours, 40 / 60);
});

test("a gap one millisecond over 30 minutes ends the block", () => {
  const report = reportFromText(file(row("2026-03-02T10:00:00Z"), row("2026-03-02T10:30:00.001Z")), { zone: UTC });
  assert.equal(report.days[0].blocks, 2);
  near(report.days[0].hours, 20 / 60);
  assert.equal(report.days[0].prompts, 2);
});

test("a day with one prompt is ten minutes", () => {
  const report = reportFromText(file(row("2026-03-02T15:00:00Z")), { zone: UTC });
  const [day] = report.days;
  assert.equal(day.day, "2026-03-02");
  near(day.hours, 10 / 60);
  assert.equal(day.blocks, 1);
  assert.equal(day.prompts, 1);
  assert.equal(day.firstPrompt, day.lastPrompt);
});

test("03:59 belongs to the day before, 04:00 to the day itself", () => {
  const before = reportFromText(file(row("2026-03-02T03:59:59Z")), { zone: UTC });
  assert.equal(before.days[0].day, "2026-03-01");
  const at = reportFromText(file(row("2026-03-02T04:00:00Z")), { zone: UTC });
  assert.equal(at.days[0].day, "2026-03-02");
});

test("a block that runs across 4am stays on the day it started", () => {
  const report = reportFromText(
    file(row("2026-03-02T03:50:00Z"), row("2026-03-02T04:10:00Z"), row("2026-03-02T04:30:00Z")),
    { zone: UTC },
  );
  assert.equal(report.days.length, 1);
  assert.equal(report.days[0].day, "2026-03-01");
  assert.equal(report.days[0].prompts, 3);
  near(report.days[0].hours, 50 / 60);
});

test("the 4am edge is on the home zone's clock, not UTC", () => {
  // 17:30 UTC is 03:30 the next morning in Brisbane and 12:30 in New York.
  const text = file(row("2026-03-02T17:30:00Z"));
  assert.equal(reportFromText(text, { zone: "Australia/Brisbane" }).days[0].day, "2026-03-02");
  assert.equal(reportFromText(text, { zone: "America/New_York" }).days[0].day, "2026-03-02");
  // An hour later it is 04:30 in Brisbane: the next day has started there.
  const later = file(row("2026-03-02T18:30:00Z"));
  assert.equal(reportFromText(later, { zone: "Australia/Brisbane" }).days[0].day, "2026-03-03");
});

test("daylight saving moves the edge with the clock", () => {
  // London is UTC in winter and UTC+1 in summer.
  const key = dayKeyer("Europe/London");
  assert.equal(key(Date.parse("2026-01-10T03:30:00Z")), "2026-01-09");
  assert.equal(key(Date.parse("2026-07-10T03:30:00Z")), "2026-07-10");
});

test("a zone that does not exist is refused, not defaulted", () => {
  assert.throws(() => reportFromText(file(row("2026-03-02T10:00:00Z")), { zone: "Mars/Olympus" }), RangeError);
});

test("an empty file is no data", () => {
  for (const text of ["", "\n\n"]) {
    const report = reportFromText(text, { zone: UTC, now: Date.parse("2026-03-02T10:00:00Z") });
    assert.equal(report.range, null);
    assert.equal(report.headline, null);
    assert.deepEqual(report.days, []);
    assert.equal(report.badLines, 0);
  }
});

test("bad lines are counted and skipped", () => {
  const text = file(
    row("2026-03-02T10:00:00Z"),
    "{not json",
    JSON.stringify({ display: "no time on this one" }),
    JSON.stringify({ display: 7, timestamp: Date.parse("2026-03-02T10:05:00Z") }),
    JSON.stringify({ display: "text time", timestamp: "yesterday" }),
    "null",
    row("2026-03-02T10:10:00Z"),
  );
  const parsed = parseHistory(text);
  assert.equal(parsed.badLines, 5);
  assert.equal(parsed.timestamps.length, 2);
  const report = reportFromText(text, { zone: UTC });
  assert.equal(report.badLines, 5);
  near(report.days[0].hours, 20 / 60);
});

test("Windows line endings are read", () => {
  const text = [row("2026-03-02T10:00:00Z"), row("2026-03-02T10:10:00Z")].join("\r\n") + "\r\n";
  const parsed = parseHistory(text);
  assert.equal(parsed.badLines, 0);
  assert.equal(parsed.timestamps.length, 2);
});

test("housekeeping rows are dropped, and only exact ones", () => {
  const text = file(
    row("2026-03-02T10:00:00Z", "login"),
    row("2026-03-02T10:01:00Z", "/login"),
    row("2026-03-02T10:02:00Z", "exit"),
    row("2026-03-02T10:03:00Z", "  /exit  "),
    row("2026-03-02T10:04:00Z", "/clear\n"),
    row("2026-03-02T12:00:00Z", "exit the loop early"),
    row("2026-03-02T12:05:00Z", "/clearly not a command"),
  );
  const parsed = parseHistory(text);
  assert.equal(parsed.dropped, 5);
  assert.equal(parsed.timestamps.length, 2);
  // The dropped rows must not stretch or start a block.
  const report = reportFromText(text, { zone: UTC });
  assert.equal(report.days[0].blocks, 1);
  near(report.days[0].hours, 15 / 60);
});

test("rows out of order are sorted first", () => {
  const sorted = file(row("2026-03-02T10:00:00Z"), row("2026-03-02T10:20:00Z"), row("2026-03-02T10:40:00Z"));
  const shuffled = file(row("2026-03-02T10:40:00Z"), row("2026-03-02T10:00:00Z"), row("2026-03-02T10:20:00Z"));
  assert.deepEqual(reportFromText(shuffled, { zone: UTC }), reportFromText(sorted, { zone: UTC }));
});

test("a day with no prompts is a zero day; a day outside the file is no data", () => {
  const text = file(row("2026-03-02T10:00:00Z"), row("2026-03-05T10:00:00Z"));
  const report = reportFromText(text, { zone: UTC, from: "2026-02-01", to: "2026-03-31" });
  // The asked-for range is cut back to what the file covers.
  assert.deepEqual(report.range, { from: "2026-03-02", to: "2026-03-05" });
  assert.deepEqual(
    report.days.map((d) => [d.day, d.blocks, d.firstPrompt === null]),
    [
      ["2026-03-02", 1, false],
      ["2026-03-03", 0, true],
      ["2026-03-04", 0, true],
      ["2026-03-05", 1, false],
    ],
  );
  assert.equal(report.headline?.totalDays, 4);
  assert.equal(report.headline?.activeDays, 2);
});

test("a range with no prompt in it is no data", () => {
  const text = file(row("2026-03-02T10:00:00Z"), row("2026-03-09T10:00:00Z"));
  const inside = reportFromText(text, { zone: UTC, from: "2026-03-04", to: "2026-03-06" });
  assert.equal(inside.headline, null);
  const outside = reportFromText(text, { zone: UTC, from: "2026-04-01", to: "2026-04-30" });
  assert.equal(outside.range, null);
});

test("with a read time, quiet days since the last prompt are zero days", () => {
  const text = file(row("2026-03-02T10:00:00Z"));
  const report = reportFromText(text, { zone: UTC, now: Date.parse("2026-03-04T12:00:00Z") });
  assert.deepEqual(report.range, { from: "2026-03-02", to: "2026-03-04" });
  assert.equal(report.headline?.totalDays, 3);
  assert.equal(report.headline?.currentStreak, 0);
});

// Ten days: on, on, on, off, off, on, on, on, on, off.
const TEN_DAYS = file(
  ...["02", "03", "04", "07", "08", "09", "10"].map((d) => row(`2026-03-${d}T10:00:00Z`)),
);

test("streaks and the longest break", () => {
  const h = headlineOf(TEN_DAYS, { to: "2026-03-10" });
  assert.deepEqual(h.longestStreak, { days: 4, from: "2026-03-07", to: "2026-03-10" });
  assert.deepEqual(h.longestBreak, { days: 2, from: "2026-03-05", to: "2026-03-06" });
  assert.equal(h.currentStreak, 4);
});

test("an empty today does not break the streak; an empty yesterday does", () => {
  const today = headlineOf(TEN_DAYS, { now: Date.parse("2026-03-11T09:00:00Z") });
  assert.equal(today.currentStreak, 4);
  const dayAfter = headlineOf(TEN_DAYS, { now: Date.parse("2026-03-12T09:00:00Z") });
  assert.equal(dayAfter.currentStreak, 0);
});

test("no day off means no longest break", () => {
  const h = headlineOf(file(row("2026-03-02T10:00:00Z"), row("2026-03-03T10:00:00Z")));
  assert.equal(h.longestBreak, null);
  assert.equal(h.longestStreak.days, 2);
});

test("big days, the medians and the peak", () => {
  // Day spans in hours, each plus the 10 minute tail: 1, 4, 6 and a short one.
  const text = file(
    row("2026-03-02T10:00:00Z"), row("2026-03-02T10:25:00Z"), row("2026-03-02T10:50:00Z"),
    ...span("2026-03-03", 10, 4 * 60 - 10),
    ...span("2026-03-04", 10, 6 * 60),
    row("2026-03-05T10:00:00Z"),
  );
  const h = headlineOf(text);
  assert.equal(h.activeDays, 4);
  assert.equal(h.bigDays, 2);
  near(h.typicalBigDay, (4 + 6 + 10 / 60) / 2);
  near(h.medianActiveDay, (1 + 4) / 2);
  assert.equal(h.peak.day, "2026-03-04");
  near(h.peak.hours, 6 + 10 / 60);
  // Under a week of history: no per-week figure is made up.
  assert.equal(h.daysPerWeek, null);
  assert.equal(h.bigDaysPerWeek, null);
  assert.equal(h.weeklyHours, null);
});

test("exactly 4 hours is a big day", () => {
  const h = headlineOf(file(...span("2026-03-03", 10, 4 * 60 - 10)));
  near(h.totalHours, 4);
  assert.equal(h.bigDays, 1);
});

test("per-week figures are the totals over the days covered", () => {
  const rows: string[] = [];
  for (let d = 0; d < 14; d += 2) rows.push(row(`2026-03-${String(1 + d).padStart(2, "0")}T10:00:00Z`));
  const h = headlineOf(file(...rows), { now: Date.parse("2026-03-14T12:00:00Z") });
  assert.equal(h.totalDays, 14);
  near(h.daysPerWeek, 3.5);
  near(h.weeklyHours, (7 * 10) / 60 / 2);
  near(h.bigDaysPerWeek, 0);
});

test("a week starts on Sunday", () => {
  // 1 March 2026 is a Sunday.
  assert.equal(weekStart("2026-03-01"), "2026-03-01");
  assert.equal(weekStart("2026-03-07"), "2026-03-01");
  assert.equal(weekStart("2026-03-08"), "2026-03-08");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");

  const text = file(row("2026-03-06T10:00:00Z"), row("2026-03-07T10:00:00Z"), row("2026-03-08T10:00:00Z"));
  const report = reportFromText(text, { zone: UTC });
  assert.deepEqual(
    report.weeks.map((w) => [w.weekStart, w.activeDays, w.daysInRange]),
    [
      ["2026-03-01", 2, 2],
      ["2026-03-08", 1, 1],
    ],
  );
});

test("matches the reference method on made-up histories", () => {
  // The reference, written the way the method was first worked out.
  const reference = (ts: number[]): Map<string, number> => {
    const out = new Map<string, number>();
    let s = ts[0];
    let p = ts[0];
    for (const t of [...ts.slice(1), null]) {
      if (t === null || (t - p) / 1000 > 30 * 60) {
        const day = new Date(s - 4 * 3_600_000).toISOString().slice(0, 10);
        out.set(day, (out.get(day) ?? 0) + ((p - s) / 1000 + 10 * 60) / 3600);
        if (t !== null) s = t;
      }
      if (t !== null) p = t;
    }
    return out;
  };

  let seed = 20260301;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let round = 0; round < 20; round++) {
    const ts: number[] = [];
    let t = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 400; i++) {
      // Mostly short gaps, some right around 30 minutes, some overnight.
      const pick = random();
      const minutes = pick < 0.7 ? random() * 20 : pick < 0.9 ? 29 + random() * 2 : 60 + random() * 1500;
      t += Math.round(minutes * 60_000);
      ts.push(t);
    }
    const expected = reference(ts);
    const rows = activeDays(ts, UTC);
    assert.equal(rows.length, expected.size);
    for (const r of rows) near(r.hours, expected.get(r.day) as number, 1e-9);
  }
});

test("two sources are one timeline: time on both at once counts once", () => {
  // The same hour on two machines, prompts interleaved ten minutes apart.
  const desk = file(row("2026-03-02T10:00:00Z", "start the build"), row("2026-03-02T10:20:00Z"), row("2026-03-02T10:40:00Z"));
  const laptop = file(row("2026-03-02T10:10:00Z", "check the logs"), row("2026-03-02T10:30:00Z"), row("2026-03-02T11:00:00Z"));
  const alone = reportFromText(desk, { zone: UTC }).days[0].hours + reportFromText(laptop, { zone: UTC }).days[0].hours;
  near(alone, 50 / 60 + 60 / 60);

  const merged = mergeSources([parseRows(desk), parseRows(laptop)]);
  assert.equal(merged.duplicates, 0);
  const report = buildReport(merged, { zone: UTC });
  assert.equal(report.days[0].blocks, 1);
  assert.equal(report.days[0].prompts, 6);
  near(report.days[0].hours, 70 / 60);
});

test("a gap on one machine is bridged by prompts on the other", () => {
  const desk = file(row("2026-03-02T10:00:00Z"), row("2026-03-02T10:50:00Z"));
  const laptop = file(row("2026-03-02T10:25:00Z", "on the couch"));
  assert.equal(reportFromText(desk, { zone: UTC }).days[0].blocks, 2);
  const report = buildReport(mergeSources([parseRows(desk), parseRows(laptop)]), { zone: UTC });
  assert.equal(report.days[0].blocks, 1);
  near(report.days[0].hours, 60 / 60);
});

test("the same prompt seen from two sources is counted once", () => {
  const history = file(row("2026-03-02T10:00:00Z", "first"), row("2026-03-02T10:20:00Z", "second"), row("2026-03-03T09:00:00Z", "third"));
  const once = parseHistory(history);
  // The same box reached two ways holds the same file.
  const merged = mergeSources([parseRows(history), parseRows(history)]);
  assert.deepEqual(merged.timestamps, once.timestamps);
  assert.equal(merged.duplicates, 3);
  assert.deepEqual(buildReport(merged, { zone: UTC }), reportFromText(history, { zone: UTC }));
});

test("two different prompts in the same millisecond on two machines both count", () => {
  const merged = mergeSources([
    parseRows(file(row("2026-03-02T10:00:00Z", "on the desk"))),
    parseRows(file(row("2026-03-02T10:00:00Z", "on the laptop"))),
  ]);
  assert.equal(merged.timestamps.length, 2);
  assert.equal(merged.duplicates, 0);
});

test("a source's own repeats survive the merge, as they do when it is read alone", () => {
  const twice = file(row("2026-03-02T10:00:00Z", "again"), row("2026-03-02T10:00:00Z", "again"));
  assert.equal(parseHistory(twice).timestamps.length, 2);
  const merged = mergeSources([parseRows(twice), parseRows(file(row("2026-03-02T10:00:00Z", "again")))]);
  assert.equal(merged.timestamps.length, 2);
  assert.equal(merged.duplicates, 1);
});

test("merging adds up dropped rows and bad lines, and one source alone is unchanged", () => {
  const a = file(row("2026-03-02T10:00:00Z"), row("2026-03-02T10:01:00Z", "/clear"), "{bad");
  const b = file(row("2026-03-05T10:00:00Z"), "{bad", "{worse");
  const merged = mergeSources([parseRows(a), parseRows(b)]);
  assert.equal(merged.dropped, 1);
  assert.equal(merged.badLines, 3);
  assert.equal(merged.timestamps.length, 2);
  assert.deepEqual(buildReport(mergeSources([parseRows(a)]), { zone: UTC }), reportFromText(a, { zone: UTC }));
});

test("no sources, or only empty ones, is no data", () => {
  for (const sources of [[], [parseRows("")], [parseRows(""), parseRows("\n")]]) {
    const report = buildReport(mergeSources(sources), { zone: UTC, now: Date.parse("2026-03-02T10:00:00Z") });
    assert.equal(report.range, null);
    assert.equal(report.headline, null);
  }
});

test("when one source fails, the numbers come from the ones that were read", () => {
  // A failed source has no rows to give; the merge is of what was read.
  const read = parseRows(file(row("2026-03-02T10:00:00Z"), row("2026-03-02T10:20:00Z")));
  const report = buildReport(mergeSources([read]), { zone: UTC });
  assert.equal(report.headline?.activeDays, 1);
  near(report.days[0].hours, 30 / 60);
});

/** Prompts every 20 minutes from `startHour`, covering `minutes` in all. */
function span(day: string, startHour: number, minutes: number): string[] {
  const start = Date.parse(`${day}T${String(startHour).padStart(2, "0")}:00:00Z`);
  const rows: string[] = [];
  for (let m = 0; m < minutes; m += 20) rows.push(rowAt(start + m * 60_000));
  rows.push(rowAt(start + minutes * 60_000));
  return rows;
}

function rowAt(ms: number): string {
  return JSON.stringify({ display: "keep going", timestamp: ms });
}
