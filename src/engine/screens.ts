// The figures behind the stats pages, made from the two reports and the
// merged prompts.
//
// No Electron and no Node import, like the other engines.
//
// Two things here handle a user's own words and names. Prompt text is
// counted into words in memory and only the counts leave; nothing made from
// it is stored. Folder names leave only through the list of projects, which
// can be asked for with every name replaced.

import {
  BIG_DAY_HOURS,
  DAY_STARTS_HOUR,
  activeDays,
  addDays,
  clockOf,
  dayKeyer,
  daysBetween,
  weekStart,
  type DayKey,
  type PromptRow,
  type Report,
} from "./hours";
import {
  comparison,
  firedInsights,
  lastWeek,
  monthCards,
  pickInsights,
  shareCard,
  styleLabel,
  type Card,
  type Comparison,
  type Insight,
  type Label,
  type LastWeek,
  type MonthCard,
} from "./insights";
import type { Usage, UsageReport } from "./transcripts";

// ---------------------------------------------------------------- this week

export interface WeekStrip {
  /** The Sunday this week began. */
  weekStart: DayKey;
  today: DayKey;
  /** Days of this week so far, today included: 1 on a Sunday, 7 on a Saturday. */
  daysSoFar: number;
  activeDays: number;
  hours: number;
  /**
   * The mean of the whole weeks before this one, and the mean of the same
   * weeks cut off at today's weekday. Null when there is no whole week yet.
   */
  average: { weeks: number; hours: number; activeDays: number; hoursByNow: number; activeDaysByNow: number } | null;
}

/** Null when the report does not reach today: there is no "this week" to show. */
export function weekStrip(report: Report | null, now: number): WeekStrip | null {
  if (!report || !report.range) return null;
  const today = dayKeyer(report.zone)(now);
  if (today !== report.range.to) return null;
  const start = weekStart(today);
  const daysSoFar = daysBetween(start, today) + 1;

  const byWeek = new Map<DayKey, Report["days"]>();
  for (const d of report.days) {
    const key = weekStart(d.day);
    byWeek.set(key, (byWeek.get(key) ?? []).concat(d));
  }
  const thisWeek = byWeek.get(start) ?? [];
  const whole = [...byWeek].filter(([key, days]) => key < start && days.length === 7).map(([, days]) => days);
  const sum = (days: Report["days"]) => days.reduce((s, d) => s + d.hours, 0);
  const used = (days: Report["days"]) => days.filter((d) => d.blocks > 0).length;
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

  return {
    weekStart: start,
    today,
    daysSoFar,
    activeDays: used(thisWeek),
    hours: sum(thisWeek),
    average: whole.length
      ? {
          weeks: whole.length,
          hours: mean(whole.map(sum)),
          activeDays: mean(whole.map(used)),
          hoursByNow: mean(whole.map((days) => sum(days.slice(0, daysSoFar)))),
          activeDaysByNow: mean(whole.map((days) => used(days.slice(0, daysSoFar)))),
        }
      : null,
  };
}

// ------------------------------------------------------------------ records

export interface Records {
  /** Prompting hours, all history. */
  biggestDay: { day: DayKey; hours: number } | null;
  /** Prompting hours in one Sunday week, all history. */
  busiestWeek: { weekStart: DayKey; hours: number; activeDays: number } | null;
  /** From transcripts. */
  longestSession: { day: DayKey; hours: number } | null;
  /** From transcripts. */
  biggestTokenDay: { day: DayKey; tokens: number } | null;
}

export function records(report: Report | null, usage: UsageReport | null): Records {
  let busiestWeek: Records["busiestWeek"] = null;
  for (const w of report?.weeks ?? []) {
    if (w.hours > 0 && (!busiestWeek || w.hours > busiestWeek.hours)) {
      busiestWeek = { weekStart: w.weekStart, hours: w.hours, activeDays: w.activeDays };
    }
  }
  return {
    biggestDay: report?.headline ? { ...report.headline.peak } : null,
    busiestWeek,
    longestSession: usage?.longestSession ?? null,
    biggestTokenDay: usage?.biggestDay ?? null,
  };
}

// ---------------------------------------------------------- the year, a day a square

/** 0 no hours; 1 under 2 hours; 2 under 4; 3 under 6; 4 six or more. A big day is 3 or 4. */
export function squareLevel(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (hours < BIG_DAY_HOURS / 2) return 1;
  if (hours < BIG_DAY_HOURS) return 2;
  if (hours < BIG_DAY_HOURS * 1.5) return 3;
  return 4;
}

export interface Square {
  day: DayKey;
  /** Null for a day outside the history: no data, which is not no hours. */
  hours: number | null;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Year {
  from: DayKey;
  to: DayKey;
  /** One per day, `from` to `to`. */
  squares: Square[];
  activeDays: number;
  hours: number;
  /** The first day the history covers, when it falls inside the year. */
  historyFrom: DayKey | null;
}

function yearBefore(day: DayKey): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  // 29 Feb a year back does not exist; the day before is near enough.
  const back = new Date(Date.UTC(y - 1, m - 1, d));
  if (back.getUTCMonth() !== m - 1) back.setUTCDate(0);
  return back.toISOString().slice(0, 10);
}

/** The last 12 months to today, from prompting hours. Null when there is no history. */
export function yearSquares(report: Report | null, now: number): Year | null {
  if (!report || !report.range) return null;
  const to = dayKeyer(report.zone)(now);
  const from = addDays(yearBefore(to), 1);
  const byDay = new Map(report.days.map((d) => [d.day, d.hours]));
  const squares: Square[] = [];
  let active = 0;
  let hours = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const inside = day >= report.range.from && day <= report.range.to;
    const h = inside ? (byDay.get(day) ?? 0) : null;
    if (h) {
      active++;
      hours += h;
    }
    squares.push({ day, hours: h, level: squareLevel(h ?? 0) });
  }
  return { from, to, squares, activeDays: active, hours, historyFrom: report.range.from > from ? report.range.from : null };
}

// ------------------------------------------------------------------- rhythm

export interface Rhythm {
  /** Sunday first. `active` days of the `of` such weekdays the history covers, and their hours. */
  weekdays: { active: number; of: number; hours: number }[];
  /** Prompts typed in each hour of the clock, midnight first, in the home zone. */
  hours: number[];
  /** Null when no prompt's time is known. */
  busiestHour: { hour: number; prompts: number } | null;
}

export function rhythm(report: Report | null, rows: PromptRow[], zone: string): Rhythm | null {
  if (!report || !report.range) return null;
  const weekdays = Array.from({ length: 7 }, () => ({ active: 0, of: 0, hours: 0 }));
  for (const d of report.days) {
    const w = weekdays[daysBetween(weekStart(d.day), d.day)];
    w.of += 1;
    w.hours += d.hours;
    if (d.blocks > 0) w.active += 1;
  }
  const clock = clockOf(zone);
  const hours = new Array<number>(24).fill(0);
  for (const row of rows) hours[clock(row.t).hour] += 1;
  let busiestHour: Rhythm["busiestHour"] = null;
  for (let hour = 0; hour < 24; hour++) {
    if (hours[hour] > 0 && (!busiestHour || hours[hour] > busiestHour.prompts)) busiestHour = { hour, prompts: hours[hour] };
  }
  return { weekdays, hours, busiestHour };
}

// -------------------------------------------------------------- late nights

export interface LateNights {
  activeDays: number;
  /** Days whose last prompt came after midnight. Before 4am it is still the day it began. */
  pastMidnight: number;
  /** The last prompt furthest into its day. `at` is that prompt's time, ms. */
  latest: { day: DayKey; at: number; pastMidnight: boolean } | null;
}

export function lateNights(report: Report | null, zone: string): LateNights | null {
  if (!report || !report.range) return null;
  const clock = clockOf(zone);
  let activeCount = 0;
  let pastMidnight = 0;
  let latest: LateNights["latest"] = null;
  let latestMinutes = -1;
  for (const d of report.days) {
    if (d.lastPrompt === null) continue;
    activeCount++;
    const c = clock(d.lastPrompt);
    const past = c.date > d.day;
    if (past) pastMidnight++;
    // Minutes since the day began at 4am.
    const minutes = ((c.hour - DAY_STARTS_HOUR + 24) % 24) * 60 + c.minute;
    if (minutes > latestMinutes) {
      latestMinutes = minutes;
      latest = { day: d.day, at: d.lastPrompt, pastMidnight: past };
    }
  }
  return { activeDays: activeCount, pastMidnight, latest };
}

// ----------------------------------------------------------- the plan price

export interface PlanPrice {
  /** What was typed before the number, such as a currency sign. Kept as typed. */
  before: string;
  /** A month's price. */
  amount: number;
  after: string;
}

/**
 * A price as someone types it: `$170`, `170`, `A$ 170.50`, `170 EUR`. The
 * sign is kept and never read: no currency is assumed and none is converted.
 * Null when there is no usable number in it.
 */
export function parsePlanPrice(text: string | undefined | null): PlanPrice | null {
  if (typeof text !== "string") return null;
  const m = /^([^\d]{0,8}?)\s*(\d[\d,]*(?:\.\d+)?)\s*([^\d]{0,8})$/.exec(text.trim());
  // A sign in front of the number is not a currency sign.
  if (!m || /[-+]/.test(m[1])) return null;
  const amount = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { before: m[1].trim(), amount, after: m[3].trim() };
}

const DAYS_IN_A_MONTH = 365.25 / 12;

/** What a monthly price comes to over a number of days. */
export function planOver(price: PlanPrice, days: number): number {
  return (price.amount / DAYS_IN_A_MONTH) * days;
}

export interface PlanValue {
  price: PlanPrice;
  /** The days the transcripts cover. */
  days: number;
  /** The plan over those days, in whatever the price was typed in. */
  cost: number;
}

// -------------------------------------------------------------------- words

// Left out of the word lists, so they are not "the" and "to".
const COMMON = new Set(
  (
    "a about after again all also am an and any are aren't as at be because been before being but by can can't " +
    "could did didn't do does doesn't doing don't down each else even every few for from get gets getting go " +
    "goes going got had has have having he her here hers him his how i i'd i'll i'm i've if in into is isn't it " +
    "it's its just let let's like ll me more most much my no nor not now of off ok okay on once one only onto or " +
    "other our ours out over own please re same she should so some such than that that's the their theirs them " +
    "then there there's these they this those through to too under until up us use used using very want was " +
    "wasn't we we're we've were what what's when where which while who whom why will with won't would yes yet " +
    "you you're your yours im ive dont cant thats whats lets ur u pls thanks thank also still need needs make " +
    "sure see look way thing things think know well back new take put give say said etc"
  ).split(" "),
);

export interface Words {
  /** How many prompts the lists were counted from. */
  prompts: number;
  words: [string, number][];
  phrases: [string, number][];
  commands: [string, number][];
}

function top(counts: Map<string, number>, limit: number, atLeast: number): [string, number][] {
  return [...counts]
    .filter(([, n]) => n >= atLeast)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
}

const WORD = /^\p{L}[\p{L}'-]*$/u;

/**
 * The most used words, two-word phrases and slash commands in a set of
 * prompts. Counts only: the texts are read and let go. Anything that looks
 * like a path, an address, a file name or a number is not a word, and a
 * pasted block's placeholder is not counted. A phrase is two words side by
 * side in one sentence with neither of them a common word. A word or phrase
 * used once is not listed.
 */
export function countWords(texts: Iterable<string>, limit = 15): Words {
  const words = new Map<string, number>();
  const phrases = new Map<string, number>();
  const commands = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  let prompts = 0;

  for (const raw of texts) {
    prompts++;
    let text = raw.replace(/\[(?:Pasted text|Image)[^\]]*\]/g, " ");
    const command = /^\s*(\/[a-z][\w:-]*)(?=\s|$)/i.exec(text);
    if (command) {
      bump(commands, command[1].toLowerCase());
      text = text.slice(command[0].length);
    }
    let previous: string | null = null;
    for (const token of text.split(/\s+/)) {
      const bare = token
        .toLowerCase()
        .replace(/’/g, "'")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!WORD.test(bare) || bare.length < 2) {
        previous = null;
        continue;
      }
      const common = COMMON.has(bare);
      if (!common) bump(words, bare);
      if (previous !== null && !common) bump(phrases, `${previous} ${bare}`);
      // A sentence ends a phrase.
      previous = common || /[.,;:!?)]$/.test(token) ? null : bare;
    }
  }
  return { prompts, words: top(words, limit, 2), phrases: top(phrases, limit, 2), commands: top(commands, limit, 1) };
}

export interface PromptStats {
  count: number;
  busiestHour: { hour: number; prompts: number } | null;
  /**
   * From the prompts whose text is in memory: null until a history has been
   * read since the app opened. Lengths and a date, never the text.
   */
  lengths: { prompts: number; longest: { chars: number; day: DayKey }; median: number } | null;
}

function promptLengths(rows: PromptRow[], zone: string): PromptStats["lengths"] {
  const keyOf = dayKeyer(zone);
  const lengths: number[] = [];
  let longest: { chars: number; day: DayKey } | null = null;
  for (const row of rows) {
    if (row.text === undefined) continue;
    const chars = [...row.text].length;
    lengths.push(chars);
    if (!longest || chars > longest.chars) longest = { chars, day: keyOf(row.t) };
  }
  if (!longest) return null;
  lengths.sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  const median = lengths.length % 2 ? lengths[mid] : (lengths[mid - 1] + lengths[mid]) / 2;
  return { prompts: lengths.length, longest, median };
}

// ----------------------------------------------------------------- projects

export interface ProjectRow {
  /** The last part of the folder's path, or a stand-in when names are hidden. */
  name: string;
  /** Prompting hours cut from this folder's prompts alone, all history. */
  hours: number;
  activeDays: number;
  prompts: number;
  /** Tokens in all for the days the transcripts cover. Null when no transcript ran there. */
  tokens: number | null;
  output: number | null;
}

function parts(folder: string): string[] {
  return folder.split(/[\\/]+/).filter((p) => p !== "");
}

/**
 * Hours and prompts by the folder each prompt was typed in, most hours
 * first, with tokens where a transcript covers the folder. With `hide`, every
 * name is replaced by its place in that order and no real name is returned.
 */
export function projectRows(rows: PromptRow[], tokens: Map<string, Usage>, zone: string, hide: boolean): ProjectRow[] {
  const times = new Map<string, number[]>();
  for (const row of rows) {
    if (row.folder === null) continue;
    const list = times.get(row.folder);
    if (list) list.push(row.t);
    else times.set(row.folder, [row.t]);
  }
  const folders = new Set([...times.keys(), ...tokens.keys()]);
  const found = [...folders].map((folder) => {
    const days = activeDays((times.get(folder) ?? []).sort((a, b) => a - b), zone);
    const used = tokens.get(folder);
    return {
      folder,
      hours: days.reduce((s, d) => s + d.hours, 0),
      activeDays: days.length,
      prompts: times.get(folder)?.length ?? 0,
      tokens: used ? used[0] + used[1] + used[2] + used[3] : null,
      output: used ? used[1] : null,
    };
  });
  found.sort((a, b) => b.hours - a.hours || (b.tokens ?? 0) - (a.tokens ?? 0) || (a.folder < b.folder ? -1 : 1));

  // The last part of the path is the name. Two folders that end the same
  // way get the part before as well.
  const short = (folder: string, n: number) => parts(folder).slice(-n).join("/") || folder;
  const uses = new Map<string, number>();
  for (const f of found) uses.set(short(f.folder, 1), (uses.get(short(f.folder, 1)) ?? 0) + 1);

  return found.map(({ folder, ...row }, i) => ({
    name: hide ? `Project ${i + 1}` : (uses.get(short(folder, 1)) ?? 0) > 1 ? short(folder, 2) : short(folder, 1),
    ...row,
  }));
}

/** One folder holding more than this share of the project hours leaves little to split. */
export const ONE_FOLDER_SHARE = 0.8;

/** The first row's hours and every row's, when the first holds most of them. Null when it does not. */
export function mostlyOneFolder(projects: ProjectRow[]): { hours: number; of: number } | null {
  const of = projects.reduce((s, p) => s + p.hours, 0);
  if (projects.length < 2 || of <= 0 || projects[0].hours <= of * ONE_FOLDER_SHARE) return null;
  return { hours: projects[0].hours, of };
}

// ---------------------------------------------------------------- all of it

export interface Screens {
  week: WeekStrip | null;
  records: Records;
  year: Year | null;
  rhythm: Rhythm | null;
  late: LateNights | null;
  /** Null when no usable plan price is set, or there are no transcripts. */
  plan: PlanValue | null;
  prompts: PromptStats | null;
  /** Null when no history has been read since the app opened, or names are hidden. */
  words: Words | null;
  projects: ProjectRow[];
  /** Set when one folder holds most of the project hours. */
  oneFolder: { hours: number; of: number } | null;
  /** Up to four lines, each a rule that holds. */
  insights: Insight[];
  /** Null under four weeks of history. */
  label: Label | null;
  /** Null when there are no transcripts. */
  comparison: Comparison | null;
  /** The week just ended. Null when the history knows nothing of it. */
  lastWeek: LastWeek | null;
  /** What the share picture says. Never a name. */
  share: Card | null;
  /** One card for each month with any use, newest first. */
  months: MonthCard[];
}

export interface ScreensInput {
  report: Report | null;
  usage: UsageReport | null;
  /** Every prompt once, as merged. Text is on the ones read since the app opened. */
  rows: PromptRow[];
  folderTokens: Map<string, Usage>;
  zone: string;
  now: number;
  /** As typed in Settings. */
  planPrice?: string;
  hideNames?: boolean;
  /** The PC's regional format, for the dates and numbers in sentences. */
  locale?: string;
}

export function buildScreens(input: ScreensInput): Screens {
  const { report, usage, rows, zone, now } = input;
  const hide = input.hideNames === true;
  const beat = rhythm(report, rows, zone);
  const price = parsePlanPrice(input.planPrice);
  const texts = rows.filter((r) => r.text !== undefined).map((r) => r.text as string);
  const year = yearSquares(report, now);
  const late = lateNights(report, zone);
  const projects = projectRows(rows, input.folderTokens, zone, hide);
  const said = { report, usage, rows, rhythm: beat, late, zone, now, locale: input.locale };
  const label = styleLabel(said);
  return {
    week: weekStrip(report, now),
    records: records(report, usage),
    year,
    rhythm: beat,
    late,
    plan: price && usage ? { price, days: usage.totalDays, cost: planOver(price, usage.totalDays) } : null,
    prompts: report?.headline
      ? { count: report.headline.prompts, busiestHour: beat?.busiestHour ?? null, lengths: promptLengths(rows, zone) }
      : null,
    words: hide || texts.length === 0 ? null : countWords(texts),
    projects,
    oneFolder: mostlyOneFolder(projects),
    insights: pickInsights(firedInsights(said)),
    label,
    comparison: comparison(usage),
    lastWeek: lastWeek(report, now, input.locale),
    share: shareCard({ ...said, year, label }),
    months: monthCards(said),
  };
}
