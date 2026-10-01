// Prompting hours from a Claude Code prompt history.
//
// No Electron and no Node import: this module runs the same under a test
// runner, in the app, and later in a page.
//
// The method:
//   - a row is one typed prompt, with `timestamp` (ms) and `display` (text);
//   - housekeeping rows (login, exit, clear) are dropped;
//   - prompts no more than 30 minutes apart are one block;
//   - a block is last prompt minus first prompt, plus 10 minutes;
//   - a block belongs to the day of its first prompt, where a day runs
//     04:00 to 04:00 in the home zone;
//   - a big day is 4 hours or more; a week starts on Sunday.
//
// The prompt text is read to drop the housekeeping rows and to tell one
// prompt from another when sources are merged. It is never stored or logged.
// What is kept of a prompt is its time, the folder it was typed in, and a
// short hash of its time and text together.

export const GAP_MINUTES = 30;
export const TAIL_MINUTES = 10;
export const DAY_STARTS_HOUR = 4;
export const BIG_DAY_HOURS = 4;

const DROPPED = new Set(["login", "/login", "exit", "/exit", "/clear"]);

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A calendar day in the home zone, `YYYY-MM-DD`. */
export type DayKey = string;

/**
 * A stretch with no gap over 30 minutes: its first and last time in ms, and
 * how many prompts it holds. This is how a source's hours are kept once its
 * rows are gone from memory: times and a count, never text.
 */
export type Span = [start: number, end: number, prompts: number];

export interface ParsedHistory {
  /** Prompt times in ms, sorted, housekeeping rows removed. */
  timestamps: number[];
  /** Stretches kept from an earlier read, counted with the timestamps. */
  spans?: Span[];
  /** Housekeeping rows that were dropped. */
  dropped: number;
  /** Lines that were not a readable history row. */
  badLines: number;
}

export interface DayRow {
  day: DayKey;
  /** Zero for a day inside the range with no prompts. */
  hours: number;
  blocks: number;
  prompts: number;
  /** ms; null on a zero day. */
  firstPrompt: number | null;
  lastPrompt: number | null;
}

export interface WeekRow {
  /** The Sunday the week starts on. */
  weekStart: DayKey;
  hours: number;
  activeDays: number;
  bigDays: number;
  /** How many of the week's seven days fall inside the range. */
  daysInRange: number;
}

export interface Run {
  days: number;
  from: DayKey;
  to: DayKey;
}

export interface Headline {
  totalDays: number;
  activeDays: number;
  bigDays: number;
  totalHours: number;
  prompts: number;
  /** The three per-week averages are null when the range is under a week. */
  daysPerWeek: number | null;
  bigDaysPerWeek: number | null;
  weeklyHours: number | null;
  medianActiveDay: number;
  /** Median of the big days; null when there is no big day. */
  typicalBigDay: number | null;
  peak: { day: DayKey; hours: number };
  currentStreak: number;
  longestStreak: Run;
  /** Null when no day in the range is a zero day. */
  longestBreak: Run | null;
}

export interface Report {
  zone: string;
  /** Null when the history holds no prompts in range: no data, not zero. */
  range: { from: DayKey; to: DayKey } | null;
  days: DayRow[];
  weeks: WeekRow[];
  headline: Headline | null;
  dropped: number;
  badLines: number;
}

export interface ReportOptions {
  /** IANA zone name, for example `Europe/London`. Required; never guessed. */
  zone: string;
  /** Limit the report to these days. Clamped to what the history covers. */
  from?: DayKey;
  to?: DayKey;
  /**
   * When the history was read, in ms. With it, the range runs to that day,
   * so quiet days since the last prompt count as zero days. Without it, the
   * range ends on the last day that has a prompt.
   */
  now?: number;
}

/** One typed prompt. */
export interface PromptRow {
  t: number;
  /**
   * A short hash of the time and the text together. It tells the same prompt
   * seen from two sources apart from two prompts typed in the same
   * millisecond, and it can be stored where the text cannot.
   */
  hash: string;
  /** The folder it was typed in. Null when the history did not say. */
  folder: string | null;
  /** In memory only, and only for a history read since the app opened. */
  text?: string;
}

/** One source's history, read but not yet merged. */
export interface SourceRows {
  rows: PromptRow[];
  dropped: number;
  badLines: number;
  /**
   * A short hash of every session the history has a row for, housekeeping
   * rows included. A session in here has its typed times in the history;
   * one that is not has them only in its transcript.
   */
  sessions?: string[];
}

export interface MergedHistory extends ParsedHistory {
  /** Every prompt once, in time order. */
  rows: PromptRow[];
  /** Prompts that a second source also held, counted once. */
  duplicates: number;
}

/** A short hash of a string (cyrb53), in base 36. */
export function idHash(id: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < id.length; i++) {
    const ch = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What stands in for a prompt in the store: time and text hashed together. */
export function promptHash(t: number, text: string): string {
  return idHash(`${t}\n${text}`);
}

export function parseRows(text: string): SourceRows {
  const rows: PromptRow[] = [];
  const sessions = new Set<string>();
  let dropped = 0;
  let badLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const r = row as { timestamp?: unknown; display?: unknown; project?: unknown; sessionId?: unknown } | null;
    if (
      r === null ||
      typeof r !== "object" ||
      typeof r.timestamp !== "number" ||
      !Number.isFinite(r.timestamp) ||
      typeof r.display !== "string"
    ) {
      badLines++;
      continue;
    }
    if (typeof r.sessionId === "string" && r.sessionId !== "") sessions.add(idHash(r.sessionId));
    if (DROPPED.has(r.display.trim())) {
      dropped++;
      continue;
    }
    rows.push({
      t: r.timestamp,
      hash: promptHash(r.timestamp, r.display),
      folder: typeof r.project === "string" && r.project !== "" ? r.project : null,
      text: r.display,
    });
  }
  return { rows, dropped, badLines, sessions: [...sessions] };
}

export function parseHistory(text: string): ParsedHistory {
  const { rows, dropped, badLines } = parseRows(text);
  return { timestamps: rows.map((r) => r.t).sort((a, b) => a - b), dropped, badLines };
}

/**
 * Several sources as one timeline, so blocks are cut across all of them and
 * time on two machines at once counts once. A prompt with the same time and
 * the same text in two sources is the same prompt and is counted once; a
 * source's own repeats are kept, as they are when it is read alone. Where
 * two sources hold a prompt, the row kept is the first source's, so list the
 * sources whose text is in memory first.
 */
export function mergeSources(sources: SourceRows[]): MergedHistory {
  const most = new Map<string, PromptRow[]>();
  let total = 0;
  let dropped = 0;
  let badLines = 0;
  for (const source of sources) {
    dropped += source.dropped;
    badLines += source.badLines;
    total += source.rows.length;
    const here = new Map<string, number>();
    for (const row of source.rows) {
      const count = (here.get(row.hash) ?? 0) + 1;
      here.set(row.hash, count);
      const seen = most.get(row.hash);
      if (!seen) most.set(row.hash, [row]);
      else if (count > seen.length) seen.push(row);
    }
  }
  const rows = [...most.values()].flat().sort((a, b) => a.t - b.t);
  return { timestamps: rows.map((r) => r.t), rows, dropped, badLines, duplicates: total - rows.length };
}

/** Throws RangeError if `zone` is not a zone this runtime knows. */
export function dayKeyer(zone: string): (ms: number) => DayKey {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return (ms) => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
    const key = `${p.year}-${p.month}-${p.day}`;
    // Before 04:00 on the clock is still the day before.
    return Number(p.hour) < DAY_STARTS_HOUR ? addDays(key, -1) : key;
  };
}

/** The clock in a zone: the calendar date, with no 4am cut, and the hour and minute. */
export function clockOf(zone: string): (ms: number) => { date: DayKey; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (ms) => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
  };
}

// Day keys are plain calendar dates, so the arithmetic is done in UTC and
// never touches a zone.
function toUtc(day: DayKey): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: DayKey, n: number): DayKey {
  return new Date(toUtc(day) + n * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

/** The Sunday on or before `day`. */
export function weekStart(day: DayKey): DayKey {
  return addDays(day, -new Date(toUtc(day)).getUTCDay());
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * The stretches in a sorted list of times. Stretches cut from one source
 * alone give the same blocks, once merged with others, as its raw times
 * would: every gap inside a stretch is already 30 minutes or less.
 */
export function spansOf(timestamps: number[]): Span[] {
  const spans: Span[] = [];
  for (const t of timestamps) {
    const open = spans[spans.length - 1];
    if (open && t - open[1] <= GAP_MINUTES * MINUTE) {
      open[1] = t;
      open[2] += 1;
    } else {
      spans.push([t, t, 1]);
    }
  }
  return spans;
}

/** One row per day that has a block, in day order. */
export function activeDays(timestamps: number[], zone: string, spans: Span[] = []): DayRow[] {
  const keyOf = dayKeyer(zone);
  const byDay = new Map<DayKey, DayRow>();
  const close = (start: number, last: number, prompts: number) => {
    const day = keyOf(start);
    let row = byDay.get(day);
    if (!row) {
      row = { day, hours: 0, blocks: 0, prompts: 0, firstPrompt: start, lastPrompt: last };
      byDay.set(day, row);
    }
    row.hours += (last - start + TAIL_MINUTES * MINUTE) / HOUR;
    row.blocks += 1;
    row.prompts += prompts;
    row.firstPrompt = Math.min(row.firstPrompt as number, start);
    row.lastPrompt = Math.max(row.lastPrompt as number, last);
  };

  // A single time is a stretch of no length.
  let items: Span[] = timestamps.map((t) => [t, t, 1]);
  if (spans.length) items = items.concat(spans).sort((a, b) => a[0] - b[0]);

  let start = 0;
  let last = 0;
  let open = false;
  let count = 0;
  for (const [from, to, prompts] of items) {
    if (open && from - last > GAP_MINUTES * MINUTE) {
      close(start, last, count);
      open = false;
    }
    if (!open) {
      start = from;
      last = to;
      count = 0;
      open = true;
    } else if (to > last) {
      last = to;
    }
    count += prompts;
  }
  if (open) close(start, last, count);

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function buildReport(parsed: ParsedHistory, opts: ReportOptions): Report {
  const keyOf = dayKeyer(opts.zone);
  const active = activeDays(parsed.timestamps, opts.zone, parsed.spans);
  const empty: Report = {
    zone: opts.zone,
    range: null,
    days: [],
    weeks: [],
    headline: null,
    dropped: parsed.dropped,
    badLines: parsed.badLines,
  };
  if (active.length === 0) return empty;

  // What the history covers. Days outside it are no data, never zero.
  const coversFrom = active[0].day;
  let coversTo = active[active.length - 1].day;
  if (opts.now !== undefined) {
    const today = keyOf(opts.now);
    if (today > coversTo) coversTo = today;
  }
  const from = opts.from && opts.from > coversFrom ? opts.from : coversFrom;
  const to = opts.to && opts.to < coversTo ? opts.to : coversTo;
  if (from > to) return empty;

  const byDay = new Map(active.map((row) => [row.day, row]));
  const days: DayRow[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(
      byDay.get(day) ?? { day, hours: 0, blocks: 0, prompts: 0, firstPrompt: null, lastPrompt: null },
    );
  }
  const activeInRange = days.filter((d) => d.blocks > 0);
  if (activeInRange.length === 0) return empty;

  const weeksByStart = new Map<DayKey, WeekRow>();
  for (const d of days) {
    const ws = weekStart(d.day);
    let w = weeksByStart.get(ws);
    if (!w) {
      w = { weekStart: ws, hours: 0, activeDays: 0, bigDays: 0, daysInRange: 0 };
      weeksByStart.set(ws, w);
    }
    w.daysInRange += 1;
    w.hours += d.hours;
    if (d.blocks > 0) w.activeDays += 1;
    if (d.hours >= BIG_DAY_HOURS) w.bigDays += 1;
  }

  // The last day is still running when the range ends today, so an empty
  // today does not break a streak yet.
  const lastDayIsLive = opts.now !== undefined && to === keyOf(opts.now);

  return {
    zone: opts.zone,
    range: { from, to },
    days,
    weeks: [...weeksByStart.values()],
    headline: headline(days, activeInRange, lastDayIsLive),
    dropped: parsed.dropped,
    badLines: parsed.badLines,
  };
}

function headline(days: DayRow[], active: DayRow[], lastDayIsLive: boolean): Headline {
  const totalDays = days.length;
  const totalHours = active.reduce((sum, d) => sum + d.hours, 0);
  const big = active.filter((d) => d.hours >= BIG_DAY_HOURS);
  const weeks = totalDays >= 7 ? totalDays / 7 : null;
  const peak = active.reduce((best, d) => (d.hours > best.hours ? d : best));

  let longestStreak: Run = { days: 0, from: active[0].day, to: active[0].day };
  let longestBreak: Run | null = null;
  let runStart = 0;
  for (let i = 1; i <= days.length; i++) {
    const wasActive = days[runStart].blocks > 0;
    if (i < days.length && days[i].blocks > 0 === wasActive) continue;
    const run: Run = { days: i - runStart, from: days[runStart].day, to: days[i - 1].day };
    if (wasActive && run.days > longestStreak.days) longestStreak = run;
    if (!wasActive && (!longestBreak || run.days > longestBreak.days)) longestBreak = run;
    runStart = i;
  }

  let end = days.length - 1;
  if (lastDayIsLive && days[end].blocks === 0) end--;
  let currentStreak = 0;
  while (end >= 0 && days[end].blocks > 0) {
    currentStreak++;
    end--;
  }

  return {
    totalDays,
    activeDays: active.length,
    bigDays: big.length,
    totalHours,
    prompts: active.reduce((sum, d) => sum + d.prompts, 0),
    daysPerWeek: weeks && active.length / weeks,
    bigDaysPerWeek: weeks && big.length / weeks,
    weeklyHours: weeks && totalHours / weeks,
    medianActiveDay: median(active.map((d) => d.hours)),
    typicalBigDay: big.length ? median(big.map((d) => d.hours)) : null,
    peak: { day: peak.day, hours: peak.hours },
    currentStreak,
    longestStreak,
    longestBreak,
  };
}

export function reportFromText(text: string, opts: ReportOptions): Report {
  return buildReport(parseHistory(text), opts);
}
