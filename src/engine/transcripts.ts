// Tokens, session hours, cost and tool counts from Claude Code transcripts.
//
// No Electron and no Node import, like the hours engine.
//
// A transcript is one `.jsonl` file per session, with sub-agents' files in
// a `subagents` folder beside it. Three kinds of line are read whole:
// `assistant` (one part of a model reply), `system` and `cost-state`. Of the
// lines a person typed, only the time is taken. Nothing else is read.
//
// What the files look like, counted on real ones on 2026-10-01:
//   - one reply is written as several `assistant` lines sharing a
//     `message.id`, and the `usage` on them grows as the reply streams, so a
//     reply is counted once, with the usage on its last line;
//   - the same reply can sit in a session's file and a sub-agent's file;
//   - lines whose model is `<synthetic>` are not model calls;
//   - `cost-state` lines carry Claude Code's own running totals for one run
//     of a session. A session that was closed and resumed has a second run
//     with its own `startTime` and totals that start again, so a session's
//     cost is the last record of each run, added up;
//   - a headless run (`claude -p`) marks its lines `entrypoint: "sdk-cli"`;
//   - a `user` line is a person typing only when it carries
//     `origin: {kind: "human"}`. On the machine this was worked out on,
//     about one `user` line in twenty did; nearly all the rest were tool
//     results, then lines Claude Code writes into the conversation itself
//     (`isMeta`), sub-agent prompts (`isSidechain`), task notifications and
//     local command output;
//     The Claude desktop app's Code sessions mark theirs the same way
//     (`origin: {kind: "human"}`, with `promptSource: "sdk"`), whether the
//     content is text, a picture or both: seen on one Windows PC;
//   - a prompt typed while the agent is busy is not a `user` line at all. It
//     is an `attachment` line whose attachment is a `queued_command` with
//     `commandMode: "prompt"` and the same `origin`, and its own `timestamp`
//     for when it was typed.
//
// The words of a reply are dropped as each line is parsed. What leaves this
// module is totals, times and names of tools and models.

import {
  type PromptRow,
  GAP_MINUTES,
  TAIL_MINUTES,
  activeDays,
  dayKeyer,
  daysBetween,
  addDays,
  idHash,
  type DayKey,
  type Span,
} from "./hours";

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * The lines wanted, as a `grep -E` pattern. A dot stands for each quote so
 * that no quote has to cross a command line. It is matched against the whole
 * line: the marker is not near the start of an `assistant` line. Another
 * kind of line can hold the same text, so the type is checked again after
 * parsing.
 */
export const WANTED_LINES = ".type.:.(assistant|system|cost-state).|" + ".origin.:..kind.:.human.";
const WANTED = new RegExp(WANTED_LINES);

export function isWanted(line: string): boolean {
  return WANTED.test(line);
}

/** How Claude Code marks a line written by a headless run. */
export const UNATTENDED_ENTRYPOINT = "sdk-cli";

/**
 * Every `entrypoint` value seen so far, and where. A value not in this list
 * is treated as attended: only a run known to have had no person at it is
 * kept out of the hours.
 */
export const ENTRYPOINTS: Record<string, { attended: boolean; seen: string }> = {
  cli: { attended: true, seen: "Claude Code in a terminal, on Linux, 2026-10-01" },
  "claude-desktop": { attended: true, seen: "the Claude desktop app's Code sessions, on Windows, 2026-10-01" },
  [UNATTENDED_ENTRYPOINT]: { attended: false, seen: "`claude -p`, on Linux, 2026-10-01" },
};

export function isUnattended(entrypoint: unknown): boolean {
  return typeof entrypoint === "string" && ENTRYPOINTS[entrypoint]?.attended === false;
}

/** How Claude Code marks what a person typed, on a `user` line or a queued prompt. */
function isHuman(origin: unknown): boolean {
  return origin !== null && typeof origin === "object" && (origin as { kind?: unknown }).kind === "human";
}

/** input, output, cache read, cache write. */
export type Usage = [input: number, output: number, cacheRead: number, cacheWrite: number];

export interface CostRecord {
  /** When that run of the session started, ms. It tells runs apart. */
  start: number;
  usd: number;
  /** Null when the record did not say: missing, not zero. */
  added: number | null;
  removed: number | null;
  /** Claude Code said it had no price for one of the models. */
  unknown: boolean;
}

export interface DayTotals {
  /** Per model: the four token kinds, then how many replies. */
  models: Record<string, [number, number, number, number, number]>;
  /** Tool uses by name. Every `mcp__` tool is counted under `mcp`. */
  tools: Record<string, number>;
  /** Claude Code's own turn timer, where it wrote one. Not used for hours. */
  turnMs?: number;
}

/** What one transcript file gave. Totals, times and names only. */
export interface FileTotals {
  /** Its size when it was read. A different size means read it again. */
  size: number;
  session: string | null;
  /** The folder the session ran in. */
  folder: string | null;
  /** A sub-agent's file. */
  sub: boolean;
  /** Stretches of the session's own times, attended. */
  runs: [number, number][];
  /** The same for lines a headless run wrote. Kept out of the hours. */
  away: [number, number][];
  /**
   * When a person typed a prompt in this session, attended. Times only.
   * Absent in a file read before these were taken.
   */
  typed?: number[];
  days: Record<DayKey, DayTotals>;
  /** Short hashes of the replies counted here, so none is counted twice. */
  ids: string[];
  /** The last record of each run of the session. */
  costs: CostRecord[];
  lines: number;
  bad: number;
}

interface Message {
  t: number;
  model: string;
  usage: Usage;
  tools: Map<string, string>;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** One file as it is read, a line at a time. Holds no reply text. */
export class TranscriptFile {
  /** Lines of the three kinds, and those that could not be parsed at all. */
  lines = 0;
  /** Of those, the ones unreadable or without the fields expected. */
  bad = 0;
  readonly messages = new Map<string, Message>();
  readonly stamps: number[] = [];
  readonly awayStamps: number[] = [];
  /** Times a person typed a prompt. The text is never kept. */
  readonly typed: number[] = [];
  readonly turns: { t: number; ms: number }[] = [];
  readonly costs = new Map<number, CostRecord>();
  session: string | null = null;
  folder: string | null = null;
  sub: boolean;

  constructor(
    readonly path: string,
    readonly size: number,
  ) {
    this.sub = path.includes("/subagents/");
  }

  feed(line: string): void {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      this.lines++;
      this.bad++;
      return;
    }
    const r = row as Record<string, unknown> | null;
    if (r === null || typeof r !== "object") {
      this.lines++;
      this.bad++;
      return;
    }
    if (r.type === "user" || r.type === "attachment") {
      this.typedLine(r);
      return;
    }
    // Another kind of line that happened to hold the marker text.
    if (r.type !== "assistant" && r.type !== "system" && r.type !== "cost-state") return;
    this.lines++;
    if (!(r.type === "cost-state" ? this.costLine(r) : this.timedLine(r))) this.bad++;
  }

  /**
   * A prompt a person typed gives its time and nothing else. A tool result,
   * a line Claude Code wrote itself, a sub-agent's prompt and anything from
   * a headless run are not a person typing.
   */
  private typedLine(r: Record<string, unknown>): void {
    if (r.isSidechain === true || r.isMeta === true || isUnattended(r.entrypoint)) return;
    let at = r.timestamp;
    if (r.type === "attachment") {
      const a = r.attachment as Record<string, unknown> | null | undefined;
      if (!a || typeof a !== "object" || a.type !== "queued_command" || a.commandMode !== "prompt" || !isHuman(a.origin)) return;
      // Typed while the agent was busy: its own time is when it was typed.
      if (typeof a.timestamp === "string" && Number.isFinite(Date.parse(a.timestamp))) at = a.timestamp;
    } else {
      if (!isHuman(r.origin)) return;
      const content = (r.message as { content?: unknown } | null | undefined)?.content;
      if (Array.isArray(content) && content.some((p) => (p as { type?: unknown } | null)?.type === "tool_result")) return;
    }
    const t = typeof at === "string" ? Date.parse(at) : NaN;
    if (!Number.isFinite(t)) return;
    if (typeof r.sessionId === "string") this.session ??= r.sessionId;
    if (typeof r.cwd === "string") this.folder ??= r.cwd;
    this.typed.push(t);
  }

  private costLine(r: Record<string, unknown>): boolean {
    if (typeof r.sessionId !== "string" || !isNumber(r.startTime) || !isNumber(r.totalCostUSD)) return false;
    this.session ??= r.sessionId;
    // A later record of the same run replaces the earlier one, even when it
    // is lower: the last is taken, not the largest.
    this.costs.set(r.startTime, {
      start: r.startTime,
      usd: r.totalCostUSD,
      added: isNumber(r.totalLinesAdded) ? r.totalLinesAdded : null,
      removed: isNumber(r.totalLinesRemoved) ? r.totalLinesRemoved : null,
      unknown: r.hasUnknownModelCost === true,
    });
    return true;
  }

  private timedLine(r: Record<string, unknown>): boolean {
    const t = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
    if (!Number.isFinite(t)) return false;

    let message: { id: string; model: string; usage: Usage; content: unknown } | null = null;
    if (r.type === "assistant") {
      const m = r.message as Record<string, unknown> | null | undefined;
      const u = m && (m.usage as Record<string, unknown> | null | undefined);
      if (!m || typeof m !== "object" || typeof m.id !== "string" || typeof m.model !== "string") return false;
      if (m.model !== "<synthetic>") {
        if (
          !u ||
          typeof u !== "object" ||
          !isNumber(u.input_tokens) ||
          !isNumber(u.output_tokens) ||
          !isNumber(u.cache_read_input_tokens) ||
          !isNumber(u.cache_creation_input_tokens)
        ) {
          return false;
        }
        message = {
          id: m.id,
          model: m.model,
          usage: [u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens],
          content: m.content,
        };
      }
    }

    if (typeof r.sessionId === "string") this.session ??= r.sessionId;
    if (typeof r.cwd === "string") this.folder ??= r.cwd;
    if (r.isSidechain === true) this.sub = true;
    (isUnattended(r.entrypoint) ? this.awayStamps : this.stamps).push(t);
    if (r.type === "system" && r.subtype === "turn_duration" && isNumber(r.durationMs)) {
      this.turns.push({ t, ms: r.durationMs });
    }

    if (message) {
      let seen = this.messages.get(message.id);
      if (!seen) {
        seen = { t, model: message.model, usage: message.usage, tools: new Map() };
        this.messages.set(message.id, seen);
      } else {
        if (t < seen.t) seen.t = t;
        seen.usage = message.usage;
      }
      // Each line carries one part of the reply. Only tool names are kept.
      if (Array.isArray(message.content)) {
        for (const part of message.content as unknown[]) {
          const p = part as { type?: unknown; id?: unknown; name?: unknown } | null;
          if (p && typeof p === "object" && p.type === "tool_use" && typeof p.name === "string") {
            seen.tools.set(typeof p.id === "string" ? p.id : `${seen.tools.size}`, p.name);
          }
        }
      }
    }
    return true;
  }

  /**
   * True when most of the file's lines could not be used: Claude Code has
   * probably changed how it writes them, and a total made from the few that
   * parsed would be a small wrong number.
   */
  get looksChanged(): boolean {
    return this.lines > 0 && this.bad * 2 > this.lines;
  }
}

// A reply is kept as a short hash of its id, for size.
export { idHash };

function runsOf(stamps: number[]): [number, number][] {
  const sorted = [...stamps].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const t of sorted) {
    const open = runs[runs.length - 1];
    if (open && t - open[1] <= GAP_MINUTES * MINUTE) open[1] = t;
    else runs.push([t, t]);
  }
  return runs;
}

function total(u: ArrayLike<number>): number {
  return u[0] + u[1] + u[2] + u[3];
}

export interface Applied {
  /** The new totals for each file that was read, by path. */
  files: Record<string, FileTotals>;
  /** Files left as they were because most of their lines could not be used. */
  changed: string[];
}

/**
 * Turns files just read into what each one gave.
 *
 * `known` is the same source's files as last stored. A file read again
 * replaces what it gave before, so a file that has grown is not counted
 * twice. A reply already counted by a file that was not read this time
 * stays with that file. Among the files read together, a reply held by more
 * than one is counted once, by the first in path order, with the largest
 * usage any of them has for it.
 */
export function applyFiles(known: Record<string, FileTotals>, batch: TranscriptFile[], zone: string): Applied {
  const keyOf = dayKeyer(zone);
  const sorted = [...batch].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const usable = sorted.filter((f) => !f.looksChanged);
  const reading = new Set(usable.map((f) => f.path));

  const elsewhere = new Set<string>();
  for (const [path, file] of Object.entries(known)) {
    if (!reading.has(path)) for (const id of file.ids) elsewhere.add(id);
  }

  const owner = new Map<string, { path: string; message: Message }>();
  for (const file of usable) {
    for (const [id, message] of file.messages) {
      const hash = idHash(id);
      if (elsewhere.has(hash)) continue;
      const held = owner.get(hash);
      if (!held) owner.set(hash, { path: file.path, message });
      else if (total(message.usage) > total(held.message.usage)) held.message = { ...held.message, usage: message.usage };
    }
  }

  const files: Record<string, FileTotals> = {};
  const dayOf = (totals: FileTotals, t: number): DayTotals => (totals.days[keyOf(t)] ??= { models: {}, tools: {} });
  for (const file of usable) {
    files[file.path] = {
      size: file.size,
      session: file.session,
      folder: file.folder,
      sub: file.sub,
      runs: runsOf(file.stamps),
      away: runsOf(file.awayStamps),
      typed: file.sub ? [] : [...new Set(file.typed)].sort((a, b) => a - b),
      days: {},
      ids: [],
      costs: [...file.costs.values()].sort((a, b) => a.start - b.start),
      lines: file.lines,
      bad: file.bad,
    };
    for (const { t, ms } of file.turns) {
      const day = dayOf(files[file.path], t);
      day.turnMs = (day.turnMs ?? 0) + ms;
    }
  }
  for (const [hash, { path, message }] of owner) {
    const totals = files[path];
    totals.ids.push(hash);
    const day = dayOf(totals, message.t);
    const model = (day.models[message.model] ??= [0, 0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) model[i] += message.usage[i];
    model[4] += 1;
    for (const name of message.tools.values()) {
      const tool = name.startsWith("mcp__") ? "mcp" : name;
      day.tools[tool] = (day.tools[tool] ?? 0) + 1;
    }
  }
  return { files, changed: sorted.filter((f) => f.looksChanged).map((f) => f.path) };
}

// ------------------------------------------------------------------ report

export interface UsageDay {
  day: DayKey;
  /** Time a session was live, agent work included. */
  sessionHours: number;
  /** Session hours less prompting hours, never below zero. */
  agentHours: number;
  /** Null on a day no transcript covers. */
  tokens: Usage | null;
  /** Null when no session with a cost record ran that day. */
  cost: number | null;
  /** The most sessions live at one moment among the blocks that began that day. */
  atOnce: number;
}

export interface UsageReport {
  /** From the first day a transcript covers to the day it was read. */
  range: { from: DayKey; to: DayKey };
  totalDays: number;
  days: UsageDay[];
  sessionHours: number;
  agentHours: number;
  /** Null when the range is under a week. */
  sessionHoursPerWeek: number | null;
  agentHoursPerWeek: number | null;
  tokens: Usage;
  byModel: Record<string, Usage>;
  replies: number;
  biggestDay: { day: DayKey; tokens: number } | null;
  /** Claude Code's own figure at list price. Null when no session has one. */
  cost: number | null;
  sessions: number;
  /** Sessions with tokens and no cost record. Their cost is missing, not zero. */
  sessionsWithoutCost: number;
  costHasUnknownModel: boolean;
  linesAdded: number | null;
  linesRemoved: number | null;
  mostAtOnce: { sessions: number; day: DayKey } | null;
  /** One session's longest stretch with no gap over 30 minutes, by the day it began. */
  longestSession: { hours: number; day: DayKey } | null;
  /** Headless runs. Their time is not in the hours; their tokens are in the tokens. */
  unattended: { runs: number; hours: number };
  tools: Record<string, number>;
  subAgents: number;
  /** Claude Code's own turn timer, added up. Shown beside agent hours once. */
  turnHours: number;
}

export interface UsageOptions {
  zone: string;
  /** When the files were read, ms. The range runs to that day. */
  now: number;
  /** Stretches of typed prompts, from the prompt histories. */
  promptSpans?: Span[];
  /** Prompting hours by day, from the hours report. */
  promptingHours?: Map<DayKey, number>;
  from?: DayKey;
  to?: DayKey;
}

function blocksOf(runs: [number, number][]): [number, number][] {
  const sorted = [...runs].sort((a, b) => a[0] - b[0]);
  const blocks: [number, number][] = [];
  for (const [from, to] of sorted) {
    const open = blocks[blocks.length - 1];
    if (open && from - open[1] <= GAP_MINUTES * MINUTE) open[1] = Math.max(open[1], to);
    else blocks.push([from, to]);
  }
  return blocks;
}

/** The same file path in two sources is one file, taken once. */
function takeFiles(sources: Record<string, FileTotals>[]): Map<string, FileTotals> {
  const files = new Map<string, FileTotals>();
  for (const source of sources) {
    for (const [path, file] of Object.entries(source)) {
      const held = files.get(path);
      if (!held || file.size > held.size) files.set(path, file);
    }
  }
  return files;
}

/**
 * Typed prompts of the sessions the prompt history does not hold, as rows
 * the hours are counted from. A session is in one ledger or the other: one
 * the history has a row for is left to the history, whole.
 *
 * `held` is the short hash of every session a prompt history has.
 */
export function typedRows(sources: Record<string, FileTotals>[], held: ReadonlySet<string>): PromptRow[] {
  const bySession = new Map<string, { times: Set<number>; folder: string | null }>();
  for (const [path, file] of takeFiles(sources)) {
    if (file.sub || !file.typed?.length) continue;
    const session = file.session ?? path;
    if (held.has(idHash(session))) continue;
    const kept = bySession.get(session) ?? { times: new Set<number>(), folder: file.folder };
    // A session written across two files gives each time once.
    for (const t of file.typed) kept.times.add(t);
    kept.folder ??= file.folder;
    bySession.set(session, kept);
  }
  const rows: PromptRow[] = [];
  for (const [session, { times, folder }] of bySession) {
    for (const t of times) rows.push({ t, hash: idHash(`${session}\n${t}`), folder });
  }
  return rows.sort((a, b) => a.t - b.t);
}

/**
 * Tokens by the folder a session ran in, for the days given. The names of
 * folders are a user's own, so this is kept apart from the report and is
 * only ever shown through the list of projects.
 */
export function folderTokens(sources: Record<string, FileTotals>[], from: DayKey, to: DayKey): Map<string, Usage> {
  const byFolder = new Map<string, Usage>();
  for (const file of takeFiles(sources).values()) {
    if (file.folder === null) continue;
    for (const [day, totals] of Object.entries(file.days)) {
      if (day < from || day > to) continue;
      for (const model of Object.values(totals.models)) {
        const sum = byFolder.get(file.folder) ?? [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) sum[i] += model[i];
        byFolder.set(file.folder, sum);
      }
    }
  }
  return byFolder;
}

/**
 * The numbers for the period the transcripts cover, from what each source's
 * files gave. The same file in two sources (two names for one box) is taken
 * once. Null when there is no transcript at all: no data, not zero.
 */
export function buildUsage(sources: Record<string, FileTotals>[], opts: UsageOptions): UsageReport | null {
  const keyOf = dayKeyer(opts.zone);
  const files = takeFiles(sources);

  let first = Infinity;
  for (const file of files.values()) {
    for (const [from] of file.runs) first = Math.min(first, from);
    for (const [from] of file.away) first = Math.min(first, from);
  }
  if (!Number.isFinite(first)) return null;

  const coversFrom = keyOf(first);
  const today = keyOf(opts.now);
  const from = opts.from && opts.from > coversFrom ? opts.from : coversFrom;
  const to = opts.to && opts.to < today ? opts.to : today;
  if (from > to) return null;
  const inRange = (day: DayKey) => day >= from && day <= to;

  // Session hours: every session's times and the typed prompts, one timeline.
  const spans: Span[] = [];
  const bySession = new Map<string, [number, number][]>();
  const awayRuns: [number, number][] = [];
  let unattendedRuns = 0;
  let subAgents = 0;
  for (const [path, file] of files) {
    for (const [a, b] of file.runs) spans.push([a, b, 0]);
    if (file.runs.length) {
      const key = file.session ?? path;
      bySession.set(key, (bySession.get(key) ?? []).concat(file.runs));
    }
    awayRuns.push(...file.away);
    const started = Math.min(file.runs[0]?.[0] ?? Infinity, file.away[0]?.[0] ?? Infinity);
    if (Number.isFinite(started) && inRange(keyOf(started))) {
      if (file.sub) subAgents++;
      else if (file.away.length && !file.runs.length) unattendedRuns++;
    }
  }
  for (const span of opts.promptSpans ?? []) if (keyOf(span[0]) >= coversFrom) spans.push(span);
  const sessionByDay = new Map(activeDays([], opts.zone, spans).map((d) => [d.day, d.hours]));

  let unattendedHours = 0;
  for (const [a, b] of blocksOf(awayRuns)) if (inRange(keyOf(a))) unattendedHours += (b - a + TAIL_MINUTES * MINUTE) / HOUR;

  // Most sessions at once: each session's own blocks, then the most that overlap.
  const edges: [number, number][] = [];
  let longestSession: UsageReport["longestSession"] = null;
  for (const runs of bySession.values()) {
    for (const [a, b] of blocksOf(runs)) {
      if (!inRange(keyOf(a))) continue;
      edges.push([a, 1], [b + TAIL_MINUTES * MINUTE, -1]);
      const hours = (b - a + TAIL_MINUTES * MINUTE) / HOUR;
      if (!longestSession || hours > longestSession.hours) longestSession = { hours, day: keyOf(a) };
    }
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let live = 0;
  let mostAtOnce: UsageReport["mostAtOnce"] = null;
  const atOnceByDay = new Map<DayKey, number>();
  for (const [t, step] of edges) {
    live += step;
    if (step < 0) continue;
    const day = keyOf(t);
    if (live > (atOnceByDay.get(day) ?? 0)) atOnceByDay.set(day, live);
    if (!mostAtOnce || live > mostAtOnce.sessions) mostAtOnce = { sessions: live, day };
  }

  // Tokens and tools by day.
  const tokensByDay = new Map<DayKey, Usage>();
  const byModel: Record<string, Usage> = {};
  const tools: Record<string, number> = {};
  const outBySession = new Map<string, Map<DayKey, number>>();
  let replies = 0;
  let turnMs = 0;
  for (const file of files.values()) {
    for (const [day, totals] of Object.entries(file.days)) {
      let out = 0;
      for (const model of Object.values(totals.models)) out += model[1];
      if (file.session !== null) {
        const days = outBySession.get(file.session) ?? new Map<DayKey, number>();
        days.set(day, (days.get(day) ?? 0) + out);
        outBySession.set(file.session, days);
      }
      if (!inRange(day)) continue;
      turnMs += totals.turnMs ?? 0;
      for (const [name, model] of Object.entries(totals.models)) {
        const dayTokens = tokensByDay.get(day) ?? [0, 0, 0, 0];
        const modelTokens = (byModel[name] ??= [0, 0, 0, 0]);
        for (let i = 0; i < 4; i++) {
          dayTokens[i] += model[i];
          modelTokens[i] += model[i];
        }
        tokensByDay.set(day, dayTokens);
        replies += model[4];
      }
      for (const [name, n] of Object.entries(totals.tools)) tools[name] = (tools[name] ?? 0) + n;
    }
  }

  // Cost and lines: each session's own figure, spread over its days by its
  // output tokens. A session with no record has no cost.
  const costs = new Map<string, Map<number, CostRecord>>();
  for (const file of files.values()) {
    if (file.session === null) continue;
    for (const record of file.costs) {
      const runs = costs.get(file.session) ?? new Map<number, CostRecord>();
      const held = runs.get(record.start);
      if (!held || record.usd > held.usd) runs.set(record.start, record);
      costs.set(file.session, runs);
    }
  }
  const costByDay = new Map<DayKey, number>();
  let cost: number | null = null;
  let linesAdded: number | null = null;
  let linesRemoved: number | null = null;
  let costHasUnknownModel = false;
  for (const [session, runs] of costs) {
    const records = [...runs.values()];
    const usd = records.reduce((sum, r) => sum + r.usd, 0);
    const added = records.reduce((sum, r) => sum + (r.added ?? 0), 0);
    const removed = records.reduce((sum, r) => sum + (r.removed ?? 0), 0);
    const hasLines = records.some((r) => r.added !== null || r.removed !== null);
    let shares = [...(outBySession.get(session) ?? [])].filter(([, out]) => out > 0);
    // No output tokens to spread by: the whole figure goes on the day it began.
    if (shares.length === 0) shares = [[keyOf(Math.min(...records.map((r) => r.start))), 1]];
    const outTotal = shares.reduce((sum, [, out]) => sum + out, 0);
    for (const [day, out] of shares) {
      if (!inRange(day)) continue;
      const share = out / outTotal;
      costByDay.set(day, (costByDay.get(day) ?? 0) + usd * share);
      cost = (cost ?? 0) + usd * share;
      if (hasLines) {
        linesAdded = (linesAdded ?? 0) + added * share;
        linesRemoved = (linesRemoved ?? 0) + removed * share;
      }
      if (records.some((r) => r.unknown)) costHasUnknownModel = true;
    }
  }
  let sessions = 0;
  let sessionsWithoutCost = 0;
  for (const [session, days] of outBySession) {
    if (![...days.keys()].some(inRange)) continue;
    sessions++;
    if (!costs.has(session)) sessionsWithoutCost++;
  }

  const days: UsageDay[] = [];
  const tokens: Usage = [0, 0, 0, 0];
  let sessionHours = 0;
  let agentHours = 0;
  let biggestDay: UsageReport["biggestDay"] = null;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const session = sessionByDay.get(day) ?? 0;
    const agent = Math.max(0, session - (opts.promptingHours?.get(day) ?? 0));
    const dayTokens = tokensByDay.get(day) ?? null;
    if (dayTokens) {
      for (let i = 0; i < 4; i++) tokens[i] += dayTokens[i];
      if (!biggestDay || total(dayTokens) > biggestDay.tokens) biggestDay = { day, tokens: total(dayTokens) };
    }
    sessionHours += session;
    agentHours += agent;
    days.push({
      day,
      sessionHours: session,
      agentHours: agent,
      tokens: dayTokens,
      cost: costByDay.get(day) ?? null,
      atOnce: atOnceByDay.get(day) ?? 0,
    });
  }

  const totalDays = daysBetween(from, to) + 1;
  const weeks = totalDays >= 7 ? totalDays / 7 : null;
  return {
    range: { from, to },
    totalDays,
    days,
    sessionHours,
    agentHours,
    sessionHoursPerWeek: weeks && sessionHours / weeks,
    agentHoursPerWeek: weeks && agentHours / weeks,
    tokens,
    byModel,
    replies,
    biggestDay,
    cost,
    sessions,
    sessionsWithoutCost,
    costHasUnknownModel,
    linesAdded,
    linesRemoved,
    mostAtOnce,
    longestSession,
    unattended: { runs: unattendedRuns, hours: unattendedHours },
    tools,
    subAgents,
    turnHours: turnMs / HOUR,
  };
}
