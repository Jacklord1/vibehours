// Things to say about the numbers, and things to show: the insight lines,
// the style label, the one comparison, last week in a line, and the text of
// the share picture and the monthly card.
//
// No Electron and no Node import, like the other engines.
//
// Every sentence made here is a rule in code: a condition, and the figures
// the sentence quotes. The sentence is true because the condition holds. A
// rule whose condition is not met says nothing; there is no softer form of
// it. A claim that one thing leads needs it clear of the next by a margin,
// and every rule states the history it needs. Nothing here gives advice,
// praise or a target. The same numbers always give the same lines.
//
// Nothing made here holds a project, a source, a host, a path or a word the
// user typed. The share picture and the card are made of this module's text
// alone, so they cannot hold one either.

import {
  BIG_DAY_HOURS,
  DAY_STARTS_HOUR,
  addDays,
  clockOf,
  dayKeyer,
  daysBetween,
  weekStart,
  type DayKey,
  type DayRow,
  type Headline,
  type PromptRow,
  type Report,
} from "./hours";
import type { LateNights, Rhythm, Year } from "./screens";
import type { UsageReport } from "./transcripts";

// ------------------------------------------------------------------ formats

/** Dates and numbers as the PC's regional format writes them. */
export interface Fmt {
  count(n: number): string;
  num(n: number, digits?: number): string;
  /** Three figures: 2.77B. */
  big(n: number): string;
  dollars(n: number): string;
  /** 8 Sep 2026. */
  day(day: DayKey): string;
  /** 8 Sep. */
  dayShort(day: DayKey): string;
  /** Two days as one stretch: 8 to 13 Sep 2026. */
  span(from: DayKey, to: DayKey): string;
  /** September 2026. */
  month(day: DayKey): string;
  /** Sunday is 0. */
  weekday(i: number, width?: "long" | "short"): string;
  /** An hour of the clock: 7 pm. */
  hour(hour: number): string;
  /** A time in the home zone. */
  time(ms: number): string;
}

function utc(day: DayKey): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formats(tag: string | undefined, zone: string): Fmt {
  let locale: string | undefined;
  try {
    locale = tag ? Intl.DateTimeFormat.supportedLocalesOf([tag])[0] : undefined;
  } catch {
    locale = undefined;
  }
  const date = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts });
  const long = date({ day: "numeric", month: "short", year: "numeric" });
  const short = date({ day: "numeric", month: "short" });
  const month = date({ month: "long", year: "numeric" });
  const hour = date({ hour: "numeric" });
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const fmt: Fmt = {
    count: (n) => n.toLocaleString(locale),
    num: (n, digits = 1) => n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    big: (n) => n.toLocaleString(locale, { notation: "compact", maximumSignificantDigits: 3 }),
    dollars: (n) => n.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
    day: (day) => long.format(utc(day)),
    dayShort: (day) => short.format(utc(day)),
    span: (from, to) =>
      from === to ? fmt.day(from) : `${from.slice(0, 4) === to.slice(0, 4) ? fmt.dayShort(from) : fmt.day(from)} to ${fmt.day(to)}`,
    month: (day) => month.format(utc(`${day.slice(0, 7)}-01`)),
    // 1 March 2026 is a Sunday.
    weekday: (i, width = "long") => date({ weekday: width }).format(Date.UTC(2026, 2, 1 + i)),
    hour: (h) => hour.format(Date.UTC(2026, 2, 1, h % 24)),
    time: (ms) => time.format(ms),
  };
  return fmt;
}

function plural(fmt: Fmt, n: number, word: string): string {
  return `${fmt.count(n)} ${word}${n === 1 ? "" : "s"}`;
}

// ------------------------------------------------------------------ context

export interface InsightInput {
  report: Report | null;
  usage: UsageReport | null;
  /** Every prompt once, for the hours of the clock. */
  rows: PromptRow[];
  rhythm: Rhythm | null;
  late: LateNights | null;
  zone: string;
  now: number;
  /** The PC's regional format. */
  locale?: string;
}

interface Month {
  /** `YYYY-MM`. */
  key: string;
  days: DayRow[];
  hours: number;
  /** Every day of the calendar month is in the history, and the month has ended. */
  whole: boolean;
}

interface Ctx extends InsightInput {
  fmt: Fmt;
  today: DayKey;
  report: Report;
  headline: Headline;
  range: { from: DayKey; to: DayKey };
  months: Month[];
  /** Days whose last prompt came after midnight. */
  pastMidnight: Set<DayKey>;
}

function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthsOf(days: DayRow[], today: DayKey): Month[] {
  const months: Month[] = [];
  for (const d of days) {
    const key = d.day.slice(0, 7);
    let open = months[months.length - 1];
    if (!open || open.key !== key) {
      open = { key, days: [], hours: 0, whole: false };
      months.push(open);
    }
    open.days.push(d);
    open.hours += d.hours;
  }
  for (const m of months) m.whole = m.key < today.slice(0, 7) && m.days.length === daysInMonth(m.key);
  return months;
}

/** Null when there is no history to say anything about. */
function context(input: InsightInput): Ctx | null {
  const { report } = input;
  if (!report || !report.range || !report.headline) return null;
  const today = dayKeyer(input.zone)(input.now);
  const clock = clockOf(input.zone);
  const pastMidnight = new Set<DayKey>();
  for (const d of report.days) if (d.lastPrompt !== null && clock(d.lastPrompt).date > d.day) pastMidnight.add(d.day);
  return {
    ...input,
    report,
    headline: report.headline,
    range: report.range,
    fmt: formats(input.locale, input.zone),
    today,
    months: monthsOf(report.days, today),
    pastMidnight,
  };
}

// -------------------------------------------------------------------- rules

/** How far clear of the next one a leader has to be, and how much history a rule waits for. */
export const MARGINS = {
  /** A weekday's average hours over the next weekday's. */
  weekday: 0.15,
  /** Share of days used, in points, under the next quietest weekday. */
  quietWeekday: 0.2,
  /** An hour's prompts over the next hour's. */
  hour: 0.15,
  /** A part of the day's prompts over the next part's. */
  dayPart: 0.25,
  /** This month's hours a day against the earlier months', either way. */
  month: 0.2,
  /** A month's hours over the next biggest, or under the next quietest. */
  monthRecord: 0.1,
  /** Agent hours over your own. */
  agentAhead: 0.2,
  /** The agent's part of session hours before it is worth a line. */
  agentShare: 0.25,
  /** Share of session days with two or more sessions at once. */
  atOnce: 0.25,
  /** Share of days used that ran past midnight. */
  lateNights: 0.1,
  /** A tool's uses over the next tool's. */
  tool: 0.25,
  /** A model's part of the output tokens. */
  model: 0.6,
  /** The busiest week over the next busiest. */
  week: 0.25,
  /** The busiest week against an average week. */
  weekOverAverage: 2,
  /** Big days as a share of days used. */
  bigShare: 0.25,
} as const;

export const NEEDS = {
  /** Days of history before anything about a habit is said. */
  days: 28,
  /** Of each weekday, before one is called the biggest or quietest. */
  eachWeekday: 8,
  /** Prompts with a known time, before an hour is called the busiest. */
  prompts: 500,
  /** Weeks, before one is called the busiest. */
  weeks: 8,
  /** Days in a row with no prompt, before a break is worth a line. */
  breakDays: 7,
  /** Days of transcripts, before agent hours are compared with yours. */
  transcriptDays: 14,
  sessionHours: 10,
  /** Days with a session, before sessions at once are spoken of. */
  sessionDays: 7,
  toolUses: 200,
  outputTokens: 100_000,
} as const;

export type Kind = "month" | "weekday" | "agent" | "hour" | "streak" | "at-once" | "big-days" | "busiest-week" | "late-nights" | "tool" | "model" | "break";

export interface Insight {
  id: string;
  kind: Kind;
  text: string;
  /** The figures the sentence quotes, unrounded, for checking it. */
  figures: Record<string, number | string>;
}

interface Rule {
  id: string;
  kind: Kind;
  /** The history it waits for, in words. */
  needs: string;
  /** Its condition, in words. `make` is the same thing in code. */
  when: string;
  make(c: Ctx): { text: string; figures: Insight["figures"] } | null;
}

/** True when `a` leads `b` by the margin. A leader of nothing is not a leader. */
function clear(a: number, b: number, margin: number): boolean {
  return a > 0 && a >= b * (1 + margin);
}

function byMost<T>(items: T[], value: (item: T) => number): T[] {
  return [...items].sort((a, b) => value(b) - value(a));
}

const DAY_PARTS = [
  { name: "at night", from: 0, to: 6 },
  { name: "in the morning", from: 6, to: 12 },
  { name: "in the afternoon", from: 12, to: 18 },
  { name: "in the evening", from: 18, to: 24 },
];

function toolLabel(name: string): string {
  return name === "mcp" ? "MCP tools" : name;
}

function longestRun(days: DayRow[], counts: (d: DayRow) => boolean): { days: number; from: DayKey; to: DayKey } | null {
  let best: { days: number; from: DayKey; to: DayKey } | null = null;
  let start = -1;
  for (let i = 0; i <= days.length; i++) {
    if (i < days.length && counts(days[i])) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0 && (!best || i - start > best.days)) best = { days: i - start, from: days[start].day, to: days[i - 1].day };
    start = -1;
  }
  return best;
}

function wholeWeeks(c: Ctx): Report["weeks"] {
  const thisWeek = weekStart(c.today);
  return c.report.weeks.filter((w) => w.daysInRange === 7 && w.weekStart < thisWeek);
}

/** In order of preference. The first four to fire, one of a kind, are shown. */
const RULES: Rule[] = [
  {
    id: "this-month",
    kind: "month",
    needs: "7 days of this month, and 2 whole calendar months before it",
    when: `prompting hours a day so far this month are ${MARGINS.month * 100}% or more above or below the same figure across the whole months before`,
    make(c) {
      const current = c.months.find((m) => m.key === c.today.slice(0, 7));
      const earlier = c.months.filter((m) => m.whole);
      if (!current || current.days.length < 7 || earlier.length < 2) return null;
      const now = current.hours / current.days.length;
      const before = earlier.reduce((s, m) => s + m.hours, 0) / earlier.reduce((s, m) => s + m.days.length, 0);
      const more = clear(now, before, MARGINS.month);
      const less = before > 0 && now <= before * (1 - MARGINS.month);
      if (!more && !less) return null;
      return {
        text:
          `So far in ${c.fmt.month(c.today)} you are averaging ${c.fmt.num(now)} prompting hours a day, ` +
          `${more ? "more" : "less"} than the ${c.fmt.num(before)} a day across your ${plural(c.fmt, earlier.length, "whole month")} before it.`,
        figures: { hoursADayNow: now, hoursADayBefore: before, daysSoFar: current.days.length, wholeMonths: earlier.length },
      };
    },
  },
  {
    id: "last-month-record",
    kind: "month",
    needs: "3 whole calendar months, the last of them the month just ended",
    when: `the month just ended has ${MARGINS.monthRecord * 100}% more prompting hours than the next biggest whole month, or the next quietest has ${MARGINS.monthRecord * 100}% more than it`,
    make(c) {
      const whole = c.months.filter((m) => m.whole);
      const last = whole[whole.length - 1];
      const before = addDays(`${c.today.slice(0, 7)}-01`, -1).slice(0, 7);
      if (whole.length < 3 || last.key !== before) return null;
      const others = byMost(whole.slice(0, -1), (m) => m.hours);
      const biggest = others[0];
      const quietest = others[others.length - 1];
      const name = c.fmt.month(`${last.key}-01`);
      if (clear(last.hours, biggest.hours, MARGINS.monthRecord)) {
        return {
          text:
            `${name} was your biggest month so far: ${c.fmt.num(last.hours)} prompting hours, ` +
            `against ${c.fmt.num(biggest.hours)} in ${c.fmt.month(`${biggest.key}-01`)}, the next biggest.`,
          figures: { hours: last.hours, next: biggest.hours, wholeMonths: whole.length },
        };
      }
      if (clear(quietest.hours, last.hours, MARGINS.monthRecord)) {
        return {
          text:
            `${name} was your quietest whole month so far: ${c.fmt.num(last.hours)} prompting hours, ` +
            `against ${c.fmt.num(quietest.hours)} in ${c.fmt.month(`${quietest.key}-01`)}, the next quietest.`,
          figures: { hours: last.hours, next: quietest.hours, wholeMonths: whole.length },
        };
      }
      return null;
    },
  },
  {
    id: "weekday-top",
    kind: "weekday",
    needs: `${NEEDS.eachWeekday} of every weekday in the history`,
    when: `one weekday's average prompting hours are ${MARGINS.weekday * 100}% or more above the next weekday's`,
    make(c) {
      const w = c.rhythm?.weekdays;
      if (!w || w.some((d) => d.of < NEEDS.eachWeekday)) return null;
      const [top, next] = byMost(w.map((d, i) => ({ i, mean: d.hours / d.of })), (d) => d.mean);
      if (!clear(top.mean, next.mean, MARGINS.weekday)) return null;
      const name = c.fmt.weekday(top.i);
      return {
        text:
          `${name} is your biggest day of the week: ${c.fmt.num(top.mean)} prompting hours on an average ${name}, ` +
          `against ${c.fmt.num(next.mean)} on a ${c.fmt.weekday(next.i)}, the next biggest.`,
        figures: { weekday: top.i, mean: top.mean, nextWeekday: next.i, nextMean: next.mean, of: w[top.i].of },
      };
    },
  },
  {
    id: "weekday-quiet",
    kind: "weekday",
    needs: `${NEEDS.eachWeekday} of every weekday in the history`,
    when: `one weekday's share of days used is ${MARGINS.quietWeekday * 100} points or more under the next quietest weekday's`,
    make(c) {
      const w = c.rhythm?.weekdays;
      if (!w || w.some((d) => d.of < NEEDS.eachWeekday)) return null;
      const sorted = byMost(w.map((d, i) => ({ i, rate: d.active / d.of })), (d) => -d.rate);
      const [low, next] = sorted;
      if (next.rate - low.rate < MARGINS.quietWeekday) return null;
      const name = c.fmt.weekday(low.i);
      const other = c.fmt.weekday(next.i);
      return {
        text:
          `${name} is your quietest day of the week: you used Claude Code on ${c.fmt.count(w[low.i].active)} of ${c.fmt.count(w[low.i].of)} ${name}s, ` +
          `against ${c.fmt.count(w[next.i].active)} of ${c.fmt.count(w[next.i].of)} ${other}s, the next quietest.`,
        figures: { weekday: low.i, used: w[low.i].active, of: w[low.i].of, nextWeekday: next.i, nextUsed: w[next.i].active, nextOf: w[next.i].of },
      };
    },
  },
  {
    id: "agent-ahead",
    kind: "agent",
    needs: `${NEEDS.transcriptDays} days of transcripts and ${NEEDS.sessionHours} session hours`,
    when: `agent hours are ${MARGINS.agentAhead * 100}% or more above your own prompting hours over the transcript period`,
    make(c) {
      const u = c.usage;
      if (!u || u.totalDays < NEEDS.transcriptDays || u.sessionHours < NEEDS.sessionHours) return null;
      const yours = u.sessionHours - u.agentHours;
      if (!clear(u.agentHours, yours, MARGINS.agentAhead)) return null;
      return {
        text:
          `Since ${c.fmt.day(u.range.from)}, the agent worked ${c.fmt.num(u.agentHours)} hours with no prompt from you, ` +
          `more than the ${c.fmt.num(yours)} hours you spent prompting.`,
        figures: { agentHours: u.agentHours, yourHours: yours, from: u.range.from },
      };
    },
  },
  {
    id: "agent-share",
    kind: "agent",
    needs: `${NEEDS.transcriptDays} days of transcripts and ${NEEDS.sessionHours} session hours`,
    when: `agent hours are ${MARGINS.agentShare * 100}% or more of session hours over the transcript period`,
    make(c) {
      const u = c.usage;
      if (!u || u.totalDays < NEEDS.transcriptDays || u.sessionHours < NEEDS.sessionHours) return null;
      if (u.agentHours < u.sessionHours * MARGINS.agentShare) return null;
      return {
        text:
          `Since ${c.fmt.day(u.range.from)}, the agent kept working for ${c.fmt.num(u.agentHours)} of your ` +
          `${c.fmt.num(u.sessionHours)} session hours with no prompt from you.`,
        figures: { agentHours: u.agentHours, sessionHours: u.sessionHours, from: u.range.from },
      };
    },
  },
  {
    id: "hour-peak",
    kind: "hour",
    needs: `${NEEDS.days} days of history and ${NEEDS.prompts} prompts with a known time`,
    when: `one hour of the clock has ${MARGINS.hour * 100}% or more prompts than the next busiest hour`,
    make(c) {
      const hours = c.rhythm?.hours;
      if (!hours || c.headline.totalDays < NEEDS.days) return null;
      const total = hours.reduce((s, n) => s + n, 0);
      if (total < NEEDS.prompts) return null;
      const [top, next] = byMost(hours.map((n, hour) => ({ hour, n })), (h) => h.n);
      if (!clear(top.n, next.n, MARGINS.hour)) return null;
      return {
        text:
          `Your busiest hour of the day starts at ${c.fmt.hour(top.hour)}: ${c.fmt.count(top.n)} of your ${c.fmt.count(total)} prompts were typed in it, ` +
          `against ${c.fmt.count(next.n)} in the hour from ${c.fmt.hour(next.hour)}, the next busiest.`,
        figures: { hour: top.hour, prompts: top.n, nextHour: next.hour, nextPrompts: next.n, total },
      };
    },
  },
  {
    id: "day-part",
    kind: "hour",
    needs: `${NEEDS.days} days of history and ${NEEDS.prompts} prompts with a known time`,
    when: `one part of the day (night, morning, afternoon, evening, six hours each) has ${MARGINS.dayPart * 100}% or more prompts than the next`,
    make(c) {
      const hours = c.rhythm?.hours;
      if (!hours || c.headline.totalDays < NEEDS.days) return null;
      const total = hours.reduce((s, n) => s + n, 0);
      if (total < NEEDS.prompts) return null;
      const parts = DAY_PARTS.map((p) => ({ ...p, n: hours.slice(p.from, p.to).reduce((s, n) => s + n, 0) }));
      const [top, next] = byMost(parts, (p) => p.n);
      if (!clear(top.n, next.n, MARGINS.dayPart)) return null;
      return {
        text:
          `More of your prompts are typed ${top.name} than in any other part of the day: ${c.fmt.count(top.n)} of ${c.fmt.count(total)} ` +
          `between ${c.fmt.hour(top.from)} and ${c.fmt.hour(top.to)}, against ${c.fmt.count(next.n)} ${next.name}.`,
        figures: { part: top.name, prompts: top.n, nextPart: next.name, nextPrompts: next.n, total },
      };
    },
  },
  {
    id: "streak-now",
    kind: "streak",
    needs: "a history that runs to today",
    when: "the run of days in a row that is still going is 7 days or more",
    make(c) {
      const h = c.headline;
      if (c.range.to !== c.today || h.currentStreak < 7) return null;
      // An empty today does not break a run, so the run may end yesterday.
      const upTo = c.report.days[c.report.days.length - 1].blocks > 0 ? "today" : "yesterday";
      const figures = { days: h.currentStreak, longest: h.longestStreak.days, upTo };
      const first = `You have used Claude Code ${c.fmt.count(h.currentStreak)} days in a row, up to ${upTo}.`;
      if (h.currentStreak >= h.longestStreak.days) return { text: `${first} That is your longest run so far.`, figures };
      return {
        text: `${first} Your longest run is ${c.fmt.count(h.longestStreak.days)} days, ${c.fmt.span(h.longestStreak.from, h.longestStreak.to)}.`,
        figures,
      };
    },
  },
  {
    id: "at-once",
    kind: "at-once",
    needs: `${NEEDS.sessionDays} days with a session in the transcripts`,
    when: `two or more sessions were live at once on ${MARGINS.atOnce * 100}% or more of the days with a session`,
    make(c) {
      const u = c.usage;
      if (!u || !u.mostAtOnce) return null;
      const withSession = u.days.filter((d) => d.atOnce >= 1).length;
      const two = u.days.filter((d) => d.atOnce >= 2).length;
      if (withSession < NEEDS.sessionDays || two < withSession * MARGINS.atOnce) return null;
      return {
        text:
          `Since ${c.fmt.day(u.range.from)}, you had two or more sessions live at once on ${c.fmt.count(two)} of ${c.fmt.count(withSession)} days with a session. ` +
          `The most at one moment was ${c.fmt.count(u.mostAtOnce.sessions)}, on ${c.fmt.day(u.mostAtOnce.day)}.`,
        figures: { daysWithTwo: two, daysWithSession: withSession, most: u.mostAtOnce.sessions, mostDay: u.mostAtOnce.day, from: u.range.from },
      };
    },
  },
  {
    id: "big-run",
    kind: "big-days",
    needs: "no more than the run itself",
    when: "the longest run of big days in a row is 3 or more",
    make(c) {
      const run = longestRun(c.report.days, (d) => d.hours >= BIG_DAY_HOURS);
      if (!run || run.days < 3) return null;
      return {
        text: `Your longest run of big days is ${c.fmt.count(run.days)} in a row, ${c.fmt.span(run.from, run.to)}. A big day is ${BIG_DAY_HOURS} prompting hours or more.`,
        figures: { days: run.days, from: run.from, to: run.to },
      };
    },
  },
  {
    id: "big-share",
    kind: "big-days",
    needs: `${NEEDS.days} days of history and 5 big days`,
    when: `big days are ${MARGINS.bigShare * 100}% or more of the days used`,
    make(c) {
      const h = c.headline;
      if (h.totalDays < NEEDS.days || h.bigDays < 5 || h.typicalBigDay === null || h.bigDays < h.activeDays * MARGINS.bigShare) return null;
      return {
        text:
          `${c.fmt.count(h.bigDays)} of your ${c.fmt.count(h.activeDays)} days used were big days of ${BIG_DAY_HOURS} prompting hours or more, ` +
          `and half of those ran ${c.fmt.num(h.typicalBigDay)} hours or longer.`,
        figures: { bigDays: h.bigDays, activeDays: h.activeDays, median: h.typicalBigDay },
      };
    },
  },
  {
    id: "busiest-week-clear",
    kind: "busiest-week",
    needs: `${NEEDS.weeks} weeks of history`,
    when: `the busiest week has ${MARGINS.week * 100}% or more prompting hours than the next busiest`,
    make(c) {
      if (c.report.weeks.length < NEEDS.weeks) return null;
      const [top, next] = byMost(c.report.weeks, (w) => w.hours);
      if (!clear(top.hours, next.hours, MARGINS.week)) return null;
      return {
        text:
          `Your busiest week was the week of ${c.fmt.day(top.weekStart)}: ${c.fmt.num(top.hours)} prompting hours, ` +
          `against ${c.fmt.num(next.hours)} in the next busiest.`,
        figures: { weekStart: top.weekStart, hours: top.hours, next: next.hours },
      };
    },
  },
  {
    id: "busiest-week-average",
    kind: "busiest-week",
    needs: `${NEEDS.weeks} whole weeks of history`,
    when: `the busiest week has ${MARGINS.weekOverAverage} times the prompting hours of an average whole week, or more`,
    make(c) {
      const whole = wholeWeeks(c);
      if (whole.length < NEEDS.weeks) return null;
      const mean = whole.reduce((s, w) => s + w.hours, 0) / whole.length;
      const [top] = byMost(c.report.weeks, (w) => w.hours);
      if (mean <= 0 || top.hours < mean * MARGINS.weekOverAverage) return null;
      return {
        text:
          `Your busiest week was the week of ${c.fmt.day(top.weekStart)}: ${c.fmt.num(top.hours)} prompting hours, ` +
          `against ${c.fmt.num(mean)} in an average week.`,
        figures: { weekStart: top.weekStart, hours: top.hours, average: mean, wholeWeeks: whole.length },
      };
    },
  },
  {
    id: "late-nights",
    kind: "late-nights",
    needs: `${NEEDS.days} days of history`,
    when: `5 or more days ran past midnight, and they are ${MARGINS.lateNights * 100}% or more of the days used`,
    make(c) {
      const late = c.late;
      if (!late || !late.latest || c.headline.totalDays < NEEDS.days) return null;
      if (late.pastMidnight < 5 || late.pastMidnight < late.activeDays * MARGINS.lateNights) return null;
      return {
        text:
          `${c.fmt.count(late.pastMidnight)} of your ${c.fmt.count(late.activeDays)} days used ran past midnight. ` +
          `The latest finish was ${c.fmt.time(late.latest.at)}, on the night of ${c.fmt.day(late.latest.day)}.`,
        figures: { pastMidnight: late.pastMidnight, activeDays: late.activeDays, latestDay: late.latest.day },
      };
    },
  },
  {
    id: "top-tool",
    kind: "tool",
    needs: `${NEEDS.toolUses} tool uses and two tools in the transcripts`,
    when: `the most used tool has ${MARGINS.tool * 100}% or more uses than the next`,
    make(c) {
      const u = c.usage;
      if (!u) return null;
      const tools = byMost(Object.entries(u.tools), ([, n]) => n);
      const total = tools.reduce((s, [, n]) => s + n, 0);
      if (tools.length < 2 || total < NEEDS.toolUses) return null;
      const [top, next] = tools;
      if (!clear(top[1], next[1], MARGINS.tool)) return null;
      return {
        text:
          `Since ${c.fmt.day(u.range.from)}, the tool the agent used most is ${toolLabel(top[0])}: ${c.fmt.count(top[1])} of ${c.fmt.count(total)} tool uses, ` +
          `against ${c.fmt.count(next[1])} for ${toolLabel(next[0])}, the next.`,
        figures: { tool: top[0], uses: top[1], nextTool: next[0], nextUses: next[1], total, from: u.range.from },
      };
    },
  },
  {
    id: "top-model",
    kind: "model",
    needs: `${NEEDS.outputTokens.toLocaleString("en-US")} output tokens and two models in the transcripts`,
    when: `one model wrote ${MARGINS.model * 100}% or more of the output tokens`,
    make(c) {
      const u = c.usage;
      if (!u) return null;
      const models = byMost(Object.entries(u.byModel), ([, t]) => t[1]);
      const total = u.tokens[1];
      if (models.length < 2 || total < NEEDS.outputTokens) return null;
      const [top, next] = models;
      if (top[1][1] < total * MARGINS.model) return null;
      return {
        text:
          `Since ${c.fmt.day(u.range.from)}, ${top[0]} wrote ${c.fmt.big(top[1][1])} of your ${c.fmt.big(total)} output tokens, ` +
          `against ${c.fmt.big(next[1][1])} from ${next[0]}, the next.`,
        figures: { model: top[0], output: top[1][1], nextModel: next[0], nextOutput: next[1][1], total, from: u.range.from },
      };
    },
  },
  {
    id: "longest-break",
    kind: "break",
    needs: `${NEEDS.weeks} weeks of history`,
    when: `the longest run of days with no prompt is ${NEEDS.breakDays} days or more`,
    make(c) {
      const h = c.headline;
      if (h.totalDays < NEEDS.weeks * 7 || !h.longestBreak || h.longestBreak.days < NEEDS.breakDays) return null;
      const off = h.totalDays - h.activeDays;
      return {
        text:
          `Your longest break is ${c.fmt.count(h.longestBreak.days)} days, ${c.fmt.span(h.longestBreak.from, h.longestBreak.to)}. ` +
          `${c.fmt.count(off)} of your ${c.fmt.count(h.totalDays)} days of history have no prompt.`,
        figures: { days: h.longestBreak.days, daysOff: off, totalDays: h.totalDays },
      };
    },
  },
];

/** Every rule, for a list of them: what it waits for and its condition. */
export const RULE_LIST: { id: string; kind: Kind; needs: string; when: string }[] = RULES.map(({ id, kind, needs, when }) => ({ id, kind, needs, when }));

export const LINES_SHOWN = 4;

/** Every rule whose condition holds, in order of preference. */
export function firedInsights(input: InsightInput): Insight[] {
  const c = context(input);
  if (!c) return [];
  const out: Insight[] = [];
  for (const rule of RULES) {
    const made = rule.make(c);
    if (made) out.push({ id: rule.id, kind: rule.kind, ...made });
  }
  return out;
}

/** The lines shown: the first of each kind, and no more than four. */
export function pickInsights(fired: Insight[], most = LINES_SHOWN): Insight[] {
  const kinds = new Set<Kind>();
  const out: Insight[] = [];
  for (const line of fired) {
    if (kinds.has(line.kind) || out.length >= most) continue;
    kinds.add(line.kind);
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------- the style label

/** The label's thresholds, in one place. */
export const LABEL = {
  /** Days of history before there is a label at all. */
  days: 28,
  /** Night owl: this share of days used finished after 11pm. */
  lateShare: 0.3,
  lateHour: 23,
  /** Early bird: this share of days used started before 7am. */
  earlyShare: 0.3,
  earlyHour: 7,
  /** Weekender: this share of prompting hours fell on a Saturday or Sunday. Two days of seven is 29%. */
  weekendShare: 0.4,
  /** Office hours: this share of prompts were typed Monday to Friday, 8am to 6pm. */
  officeShare: 0.7,
  officeFrom: 8,
  officeTo: 18,
  /** And the times of at least this share of the prompts have to be known. */
  officeKnown: 0.9,
  /** Long-hauler: this share of days used were big days. */
  bigShare: 0.4,
  /** Little and often: this many days a week, with a median day under this many hours. */
  oftenDaysAWeek: 4,
  oftenMedianHours: 2,
  /** Daily regular: used on this share of all days. */
  dailyShare: 0.85,
  /** Juggler: two or more sessions at once on this share of days with a session, of at least this many. */
  jugglerShare: 0.5,
  jugglerDays: 14,
} as const;

export interface Label {
  id: string;
  name: string;
  /** One line saying why, with its figures. */
  why: string;
}

interface LabelRule {
  id: string;
  name: string;
  /** Its rule, in words. */
  when: string;
  why(c: Ctx): string | null;
}

/** In order: the first whose rule holds is the label. The last always holds. */
const LABELS: LabelRule[] = [
  {
    id: "night-owl",
    name: "Night owl",
    when: `${LABEL.lateShare * 100}% or more of days used finished after 11pm`,
    why(c) {
      const clock = clockOf(c.zone);
      const active = c.report.days.filter((d) => d.lastPrompt !== null);
      const late = active.filter((d) => c.pastMidnight.has(d.day) || clock(d.lastPrompt as number).hour >= LABEL.lateHour).length;
      if (late < active.length * LABEL.lateShare) return null;
      return `${c.fmt.count(late)} of your ${c.fmt.count(active.length)} days used finished after ${c.fmt.hour(LABEL.lateHour)}.`;
    },
  },
  {
    id: "early-bird",
    name: "Early bird",
    when: `${LABEL.earlyShare * 100}% or more of days used started before 7am`,
    why(c) {
      const clock = clockOf(c.zone);
      const active = c.report.days.filter((d) => d.firstPrompt !== null);
      // A day starts at 4am, so a start before 7 is between 4 and 7.
      const early = active.filter((d) => {
        const hour = clock(d.firstPrompt as number).hour;
        return hour >= DAY_STARTS_HOUR && hour < LABEL.earlyHour;
      }).length;
      if (early < active.length * LABEL.earlyShare) return null;
      return `${c.fmt.count(early)} of your ${c.fmt.count(active.length)} days used started before ${c.fmt.hour(LABEL.earlyHour)}.`;
    },
  },
  {
    id: "weekender",
    name: "Weekender",
    when: `${LABEL.weekendShare * 100}% or more of prompting hours fell on a Saturday or Sunday`,
    why(c) {
      const w = c.rhythm?.weekdays;
      if (!w) return null;
      const weekend = w[0].hours + w[6].hours;
      if (weekend < c.headline.totalHours * LABEL.weekendShare) return null;
      return `${c.fmt.num(weekend, 0)} of your ${c.fmt.num(c.headline.totalHours, 0)} prompting hours fell on a Saturday or Sunday.`;
    },
  },
  {
    id: "office-hours",
    name: "Office hours",
    when: `${LABEL.officeShare * 100}% or more of prompts were typed Monday to Friday between 8am and 6pm, with the times of ${LABEL.officeKnown * 100}% of prompts known`,
    why(c) {
      if (c.rows.length === 0 || c.rows.length < c.headline.prompts * LABEL.officeKnown) return null;
      const clock = clockOf(c.zone);
      let office = 0;
      for (const row of c.rows) {
        const at = clock(row.t);
        const weekday = new Date(utc(at.date)).getUTCDay();
        if (weekday >= 1 && weekday <= 5 && at.hour >= LABEL.officeFrom && at.hour < LABEL.officeTo) office++;
      }
      if (office < c.rows.length * LABEL.officeShare) return null;
      return `${c.fmt.count(office)} of your ${c.fmt.count(c.rows.length)} prompts were typed on a weekday between ${c.fmt.hour(LABEL.officeFrom)} and ${c.fmt.hour(LABEL.officeTo)}.`;
    },
  },
  {
    id: "long-hauler",
    name: "Long-hauler",
    when: `${LABEL.bigShare * 100}% or more of days used were big days`,
    why(c) {
      const h = c.headline;
      if (h.bigDays < h.activeDays * LABEL.bigShare) return null;
      return `${c.fmt.count(h.bigDays)} of your ${c.fmt.count(h.activeDays)} days used ran ${BIG_DAY_HOURS} prompting hours or more.`;
    },
  },
  {
    id: "little-and-often",
    name: "Little and often",
    when: `${LABEL.oftenDaysAWeek} or more days a week, with a median day under ${LABEL.oftenMedianHours} prompting hours`,
    why(c) {
      const h = c.headline;
      if (h.daysPerWeek === null || h.daysPerWeek < LABEL.oftenDaysAWeek || h.medianActiveDay >= LABEL.oftenMedianHours) return null;
      return `You use it ${c.fmt.num(h.daysPerWeek)} days a week, and half your days are under ${c.fmt.num(h.medianActiveDay)} prompting hours.`;
    },
  },
  {
    id: "daily-regular",
    name: "Daily regular",
    when: `Claude Code was used on ${LABEL.dailyShare * 100}% or more of all days`,
    why(c) {
      const h = c.headline;
      if (h.activeDays < h.totalDays * LABEL.dailyShare) return null;
      return `You used Claude Code on ${c.fmt.count(h.activeDays)} of ${c.fmt.count(h.totalDays)} days.`;
    },
  },
  {
    id: "juggler",
    name: "Juggler",
    when: `two or more sessions were live at once on ${LABEL.jugglerShare * 100}% or more of days with a session, of ${LABEL.jugglerDays} or more`,
    why(c) {
      const u = c.usage;
      if (!u) return null;
      const withSession = u.days.filter((d) => d.atOnce >= 1).length;
      const two = u.days.filter((d) => d.atOnce >= 2).length;
      if (withSession < LABEL.jugglerDays || two < withSession * LABEL.jugglerShare) return null;
      return `Since ${c.fmt.day(u.range.from)}, two or more sessions were live at once on ${c.fmt.count(two)} of ${c.fmt.count(withSession)} days with a session.`;
    },
  },
  {
    id: "vibe-coder",
    name: "Vibe coder",
    when: "none of the others holds",
    why: (c) => `No one habit stands out in your ${c.fmt.count(c.headline.totalDays)} days of history.`,
  },
];

export const LABEL_LIST: { id: string; name: string; when: string }[] = LABELS.map(({ id, name, when }) => ({ id, name, when }));

/** Null under four weeks of history. */
export function styleLabel(input: InsightInput): Label | null {
  const c = context(input);
  if (!c || c.headline.totalDays < LABEL.days) return null;
  for (const rule of LABELS) {
    const why = rule.why(c);
    if (why !== null) return { id: rule.id, name: rule.name, why };
  }
  return null;
}

// ----------------------------------------------------------- the comparison

/**
 * The one published figure the app compares with, fixed in the build with
 * the day it was read. The app fetches nothing itself: the link is opened in
 * the user's own browser.
 */
export const PUBLISHED_COST = {
  /** US dollars per developer per active day. */
  average: 13,
  /** Nine users in ten are under this, per active day. */
  ninetyPercentUnder: 30,
  who: "Anthropic",
  where: "Claude Code docs, “Manage costs effectively”",
  url: "https://code.claude.com/docs/en/costs",
  /** The day the page was read and the figure taken from it. */
  readOn: "2026-10-01",
  quote:
    "Across enterprise deployments, the average cost is around $13 per developer per active day and $150-250 per developer per month, " +
    "with costs remaining below $30 per active day for 90% of users.",
} as const;

export interface Comparison {
  /** Days in the transcript period with a model reply. */
  activeDays: number;
  /** List-price value over the period, US dollars. Null when Claude Code kept no cost. */
  cost: number | null;
  /** Null without a cost, or without an active day. */
  perActiveDay: number | null;
  from: DayKey;
  to: DayKey;
  /** The figure it sits beside, with its source and the day it was read. */
  published: typeof PUBLISHED_COST;
}

export function comparison(usage: UsageReport | null): Comparison | null {
  if (!usage) return null;
  const activeDays = usage.days.filter((d) => d.tokens !== null).length;
  return {
    activeDays,
    cost: usage.cost,
    perActiveDay: usage.cost !== null && activeDays > 0 ? usage.cost / activeDays : null,
    from: usage.range.from,
    to: usage.range.to,
    published: PUBLISHED_COST,
  };
}

// ---------------------------------------------------------------- last week

export interface LastWeek {
  /** The first and last day of the week just ended that the history covers. */
  from: DayKey;
  to: DayKey;
  activeDays: number;
  hours: number;
  /** Null in a week with no use. */
  biggest: { day: DayKey; hours: number } | null;
  /** The line, ready to show. */
  text: string;
}

/**
 * The Sunday week before this one. Null when the history does not reach
 * today, or began after that week ended: there is nothing to say about a
 * week the app knows nothing of.
 */
export function lastWeek(report: Report | null, now: number, locale?: string): LastWeek | null {
  if (!report || !report.range) return null;
  const today = dayKeyer(report.zone)(now);
  if (report.range.to !== today) return null;
  const start = addDays(weekStart(today), -7);
  const end = addDays(start, 6);
  if (report.range.from > end) return null;
  const days = report.days.filter((d) => d.day >= start && d.day <= end);
  const fmt = formats(locale, report.zone);
  const from = days[0].day;
  const used = days.filter((d) => d.blocks > 0);
  const hours = used.reduce((s, d) => s + d.hours, 0);
  const biggest = used.length ? used.reduce((best, d) => (d.hours > best.hours ? d : best)) : null;
  const when = `Last week, ${fmt.span(from, end)}`;
  const text = biggest
    ? `${when}: ${plural(fmt, used.length, "day")} used, ${fmt.num(hours)} prompting hours, ` +
      `the biggest ${fmt.weekday(daysBetween(weekStart(biggest.day), biggest.day))} ${fmt.dayShort(biggest.day)} at ${fmt.num(biggest.hours)} hours.`
    : `${when}: you did not use Claude Code.`;
  return { from, to: end, activeDays: used.length, hours, biggest: biggest && { day: biggest.day, hours: biggest.hours }, text };
}

/** What the app remembers about the line: the week it was last shown for, and whether it was closed. */
export interface WeekLineSeen {
  /** The Sunday of the week the app was last opened in. */
  week: DayKey;
  closed: boolean;
}

/**
 * Whether last week's line is up. It comes up the first time the app is
 * opened in a new week and stays until it is closed or the week ends. A
 * first-ever open shows nothing: it is remembered as already closed.
 */
export function weekLine(seen: WeekLineSeen | undefined, now: number, zone: string, firstEver: boolean): WeekLineSeen {
  const week = weekStart(dayKeyer(zone)(now));
  if (firstEver) return { week, closed: true };
  if (!seen || seen.week < week) return { week, closed: false };
  return seen;
}

// ------------------------------------------------- the picture and the card

export interface CardFigure {
  value: string;
  /** What the value is in. May be empty. */
  unit: string;
  /** What it measures, in words. Never empty. */
  measure: string;
}

/**
 * Everything written on a share picture or a monthly card. The page draws
 * these strings and no others, so a name that is not in here cannot be on
 * the picture.
 */
export interface Card {
  /** The app's name. */
  name: string;
  heading: string;
  /** One line under the heading. May be empty. */
  sub: string;
  /** The days it covers. */
  period: string;
  figures: CardFigure[];
  /** One per day, in day order. `out` is a day with no history: no data, not no hours. */
  squares: { day: DayKey; level: 0 | 1 | 2 | 3 | 4; out: boolean }[];
  squaresNote: string;
  /** What each of the five shades means, lightest first. */
  squaresKey: string[];
  /** One insight line. Null when none is true. */
  line: string | null;
  footer: string;
}

const APP_NAME = "Vibehours";
const SQUARES_KEY = ["No hours", "Under 2 h", "2 to 4 h", "4 to 6 h", "6 h or more"];
const FOOTER = "Counted by Vibehours from the history Claude Code keeps";

function level(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (hours < BIG_DAY_HOURS / 2) return 1;
  if (hours < BIG_DAY_HOURS) return 2;
  if (hours < BIG_DAY_HOURS * 1.5) return 3;
  return 4;
}

/** Every string on a card, for checking what it says. */
export function cardText(card: Card): string[] {
  return [
    card.name,
    card.heading,
    card.sub,
    card.period,
    ...card.figures.flatMap((f) => [f.value, f.unit, f.measure]),
    card.squaresNote,
    ...card.squaresKey,
    card.line ?? "",
    card.footer,
  ].filter((s) => s !== "");
}

export interface CardInput extends InsightInput {
  year: Year | null;
  label: Label | null;
}

/** The share picture: all history. Null when there is no history. */
export function shareCard(input: CardInput): Card | null {
  const c = context(input);
  if (!c || !input.year) return null;
  const h = c.headline;
  const u = c.usage;
  const figures: CardFigure[] = [];
  if (h.daysPerWeek !== null && h.weeklyHours !== null) {
    figures.push(
      { value: c.fmt.num(h.daysPerWeek), unit: "days a week", measure: "Days with a prompt, of every seven" },
      { value: c.fmt.num(h.weeklyHours), unit: "h a week", measure: "Prompting hours: time spent typing prompts" },
    );
  } else {
    figures.push(
      { value: c.fmt.count(h.activeDays), unit: h.activeDays === 1 ? "day" : "days", measure: "Days with a prompt" },
      { value: c.fmt.num(h.totalHours), unit: "h", measure: "Prompting hours: time spent typing prompts" },
    );
  }
  figures.push(
    { value: c.fmt.num(h.peak.hours), unit: "h", measure: `Biggest day, in prompting hours: ${c.fmt.day(h.peak.day)}` },
    { value: c.fmt.count(h.longestStreak.days), unit: h.longestStreak.days === 1 ? "day" : "days", measure: "Longest run of days in a row" },
  );
  if (u) {
    const since = `since ${c.fmt.dayShort(u.range.from)}`;
    figures.push(
      u.sessionHoursPerWeek !== null
        ? { value: c.fmt.num(u.sessionHoursPerWeek), unit: "h a week", measure: `Session hours ${since}, agent work included` }
        : { value: c.fmt.num(u.sessionHours), unit: "h", measure: `Session hours ${since}, agent work included` },
      { value: c.fmt.big(u.tokens[0] + u.tokens[1] + u.tokens[2] + u.tokens[3]), unit: "tokens", measure: `Every token ${since}, cache reads included` },
    );
  } else {
    figures.push(
      { value: c.fmt.count(h.bigDays), unit: h.bigDays === 1 ? "big day" : "big days", measure: `Days of ${BIG_DAY_HOURS} prompting hours or more` },
      { value: c.fmt.count(h.prompts), unit: "prompts", measure: "Prompts typed, in all" },
    );
  }
  return {
    name: APP_NAME,
    heading: input.label?.name ?? "Vibe coding with Claude Code",
    sub: input.label?.why ?? "",
    period: `${c.fmt.span(c.range.from, c.range.to)}, ${plural(c.fmt, h.totalDays, "day")}`,
    figures,
    squares: input.year.squares.map((s) => ({ day: s.day, level: s.level, out: s.hours === null })),
    squaresNote: "One square a day for the last 12 months, by prompting hours",
    squaresKey: SQUARES_KEY,
    line: null,
    footer: FOOTER,
  };
}

/** How far clear of the next a month card's busiest weekday has to be. */
export const MONTH_WEEKDAY_MARGIN = 0.1;
/** And how many of the month's days the history has to hold: three of every weekday. */
export const MONTH_WEEKDAY_DAYS = 21;

/** The first of these that is true of the month is its line. */
function monthLine(c: Ctx, m: Month, used: DayRow[]): string | null {
  const whole = c.months.filter((x) => x.whole);
  if (m.whole && whole.length >= 3) {
    const [next] = byMost(whole.filter((x) => x.key !== m.key), (x) => x.hours);
    if (clear(m.hours, next.hours, MARGINS.monthRecord)) {
      return `Your biggest month so far: ${c.fmt.num(m.hours)} prompting hours, against ${c.fmt.num(next.hours)} in ${c.fmt.month(`${next.key}-01`)}, the next biggest.`;
    }
  }
  if (m.whole && used.length === m.days.length) return "You used Claude Code on every day of the month.";
  const run = longestRun(m.days, (d) => d.blocks > 0);
  if (run && run.days >= 7) return `Your longest run in the month was ${c.fmt.count(run.days)} days in a row, ${c.fmt.span(run.from, run.to)}.`;
  const big = used.filter((d) => d.hours >= BIG_DAY_HOURS).length;
  if (big >= 4) return `${c.fmt.count(big)} of the ${c.fmt.count(used.length)} days you used were big days of ${BIG_DAY_HOURS} prompting hours or more.`;
  const late = used.filter((d) => c.pastMidnight.has(d.day)).length;
  if (late >= 3) return `${c.fmt.count(late)} of the ${c.fmt.count(used.length)} days you used ran past midnight.`;
  return null;
}

export interface MonthCard {
  /** `YYYY-MM`. */
  month: string;
  /** September 2026. */
  name: string;
  /** The month is still running. */
  soFar: boolean;
  card: Card;
}

/** One card for each month with any use, newest first. A month with no use has no card. */
export function monthCards(input: InsightInput): MonthCard[] {
  const c = context(input);
  if (!c) return [];
  const out: MonthCard[] = [];
  for (const m of c.months) {
    const used = m.days.filter((d) => d.blocks > 0);
    if (used.length === 0) continue;
    const first = m.days[0].day;
    const last = m.days[m.days.length - 1].day;
    const current = m.key === c.today.slice(0, 7);
    const peak = used.reduce((best, d) => (d.hours > best.hours ? d : best));
    const figures: CardFigure[] = [
      { value: c.fmt.count(used.length), unit: `of ${plural(c.fmt, m.days.length, "day")}`, measure: "Days with a prompt" },
      { value: c.fmt.num(m.hours), unit: "h", measure: "Prompting hours: time spent typing prompts" },
      { value: c.fmt.num(peak.hours), unit: "h", measure: `Biggest day, in prompting hours: ${c.fmt.dayShort(peak.day)}` },
    ];

    // A weekday leads only when it is clear of the next.
    const weekdays = Array.from({ length: 7 }, (_, i) => ({ i, hours: 0, of: 0 }));
    for (const d of m.days) {
      const w = weekdays[daysBetween(weekStart(d.day), d.day)];
      w.hours += d.hours;
      w.of += 1;
    }
    const [top, next] = byMost(weekdays, (w) => w.hours);
    if (m.days.length >= MONTH_WEEKDAY_DAYS && clear(top.hours, next.hours, MONTH_WEEKDAY_MARGIN)) {
      const name = c.fmt.weekday(top.i);
      figures.push({ value: name, unit: "", measure: `Busiest weekday: ${c.fmt.num(top.hours)} prompting hours over ${c.fmt.count(top.of)} ${name}s` });
    }

    // Tokens only where the transcripts cover every day of the month the history has.
    const u = c.usage;
    if (u && u.range.from <= first && u.range.to >= last) {
      let tokens = 0;
      for (const d of u.days) if (d.day >= first && d.day <= last && d.tokens) tokens += d.tokens[0] + d.tokens[1] + d.tokens[2] + d.tokens[3];
      if (tokens > 0) figures.push({ value: c.fmt.big(tokens), unit: "tokens", measure: "Every token, cache reads included" });
    }

    const squares: Card["squares"] = [];
    const hoursOf = new Map(m.days.map((d) => [d.day, d.hours]));
    for (let i = 1; i <= daysInMonth(m.key); i++) {
      const day = `${m.key}-${String(i).padStart(2, "0")}`;
      const hours = hoursOf.get(day);
      squares.push({ day, level: level(hours ?? 0), out: hours === undefined });
    }
    const name = c.fmt.month(first);
    out.push({
      month: m.key,
      name,
      soFar: current,
      card: {
        name: APP_NAME,
        heading: name,
        sub: "",
        period: `${c.fmt.span(first, last)}, ${plural(c.fmt, m.days.length, "day")}${current ? ", the month so far" : ""}`,
        figures,
        squares,
        squaresNote: "One square a day, by prompting hours",
        squaresKey: SQUARES_KEY,
        line: monthLine(c, m, used),
        footer: FOOTER,
      },
    });
  }
  return out.reverse();
}
