// What has been read since the app opened, and the store it is kept in.
//
// The prompt rows hold prompt text, so they live here in memory and nowhere
// else: never on disk, never sent to the page as text. What goes to the
// store is times, counts, totals and short hashes. No Electron import, so it runs under the test
// runner.

import {
  buildReport,
  mergeSources,
  parseRows,
  spansOf,
  type DayKey,
  type Report,
  type SourceRows,
  type Span,
} from "../engine/hours";
import { buildScreens, type Screens } from "../engine/screens";
import { TranscriptFile, applyFiles, buildUsage, folderTokens, typedRows, type UsageReport } from "../engine/transcripts";
import { sourceKey, systemReader, type Failure, type Reader, type Source } from "./sources";
import { rowsOf, storedRows, type Store } from "./store";

type Reason = Failure["reason"];

export type HistoryState =
  | { state: "unread" }
  | { state: "ok"; readAt: number; prompts: number; firstPrompt: number | null }
  | { state: "failed"; readAt: number; reason: Reason; detail: string };

export type TranscriptState =
  | { state: "unread" }
  /** `files` on the source, `read` of them this time, `changed` left out as unreadable. */
  | { state: "ok"; readAt: number; files: number; read: number; changed: number }
  | { state: "failed"; readAt: number; reason: Reason; detail: string };

export type SourceStatus = HistoryState & {
  source: Source;
  /** What is being read right now, if anything. */
  reading: "history" | "transcripts" | null;
  /** When the prompting hours the store holds for this source were read. Null if it holds none. */
  storedAt: number | null;
  /** The same for what its transcripts gave. */
  transcriptsStoredAt: number | null;
  transcripts: TranscriptState;
  /** Another box only: whether it already keeps its transcripts longer. Null when not known. */
  keepsLonger: boolean | null;
};

export interface Numbers {
  /** Null when there is no prompt history to count. Never a made-up zero. */
  report: Report | null;
  /** Null when there is no transcript to count. */
  usage: UsageReport | null;
  /** The figures behind the pages, made from the two reports. */
  screens: Screens;
  readAt: number;
  duplicates: number;
  /** Prompts whose times came from transcripts, for sessions no prompt history holds. */
  fromTranscripts: number;
}

export interface NumbersOptions {
  /** The plan price as typed in Settings. */
  planPrice?: string;
  /** Replace every project name, and count no words. */
  hideNames?: boolean;
  /** The PC's regional format. */
  locale?: string;
}

interface Live {
  history: HistoryState;
  transcripts: TranscriptState;
  reading: SourceStatus["reading"];
  keepsLonger: boolean | null;
}

export class Session {
  private readonly rows = new Map<string, SourceRows>();
  private readonly live = new Map<string, Live>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly reader: Reader = systemReader,
    /** Called after the store has changed, to write it. */
    private readonly save: () => void = () => undefined,
  ) {}

  private liveOf(source: Source): Live {
    const key = sourceKey(source);
    let live = this.live.get(key);
    if (!live) {
      live = { history: { state: "unread" }, transcripts: { state: "unread" }, reading: null, keepsLonger: null };
      this.live.set(key, live);
    }
    return live;
  }

  /**
   * Reads one source: its prompt history, then its transcripts. A failure is
   * recorded, never thrown, and what the store already holds is left alone.
   * `onChange` is called each time there is something new to show.
   */
  read(source: Source, onChange: () => void = () => undefined, now = Date.now): Promise<void> {
    const key = sourceKey(source);
    let running = this.inFlight.get(key);
    if (!running) {
      running = this.readOnce(source, onChange, now).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, running);
    }
    return running;
  }

  private async readOnce(source: Source, onChange: () => void, now: () => number): Promise<void> {
    const key = sourceKey(source);
    const live = this.liveOf(source);

    live.reading = "history";
    onChange();
    const fetched = await this.reader.history(source);
    if (!fetched.ok) {
      this.rows.delete(key);
      live.history = { state: "failed", readAt: now(), reason: fetched.reason, detail: fetched.detail };
    } else {
      const parsed = parseRows(fetched.text);
      const lines = parsed.rows.length + parsed.dropped + parsed.badLines;
      if (lines > 0 && parsed.badLines * 2 > lines) {
        // Most of it could not be read. A total from the few lines that
        // parsed would pass for the whole, so none is made.
        this.rows.delete(key);
        live.history = { state: "failed", readAt: now(), reason: "changed", detail: `${parsed.badLines} of ${lines}` };
      } else {
        const times = parsed.rows.map((r) => r.t).sort((a, b) => a - b);
        this.rows.set(key, parsed);
        live.history = { state: "ok", readAt: now(), prompts: times.length, firstPrompt: times.length ? times[0] : null };
        const stored = (this.store.sources[key] ??= { files: {} });
        stored.prompts = { readAt: now(), ...storedRows(parsed.rows), dropped: parsed.dropped, badLines: parsed.badLines, sessions: parsed.sessions ?? [] };
        this.save();
      }
    }

    // A box that could not be reached is not asked a second time.
    const unreachable = live.history.state === "failed" && ["failed", "program-missing"].includes(live.history.reason);
    if (!unreachable) {
      live.reading = "transcripts";
      onChange();
      live.transcripts = await this.readTranscripts(source, live, now);
    }
    live.reading = null;
    onChange();
  }

  private async readTranscripts(source: Source, live: Live, now: () => number): Promise<TranscriptState> {
    const listed = await this.reader.list(source);
    if (!listed.ok) return { state: "failed", readAt: now(), reason: listed.reason, detail: listed.detail };
    live.keepsLonger = listed.keepsLonger;

    const key = sourceKey(source);
    const known = this.store.sources[key]?.files ?? {};
    // Transcripts only grow, so a file whose size has not changed is not read again.
    const wanted = listed.files.filter((f) => known[f.path]?.size !== f.size);
    let changed = 0;
    if (wanted.length) {
      const batch = new Map(wanted.map((f) => [f.path, new TranscriptFile(f.path, f.size)]));
      const pulled = await this.reader.pull(
        source,
        wanted.map((f) => f.path),
        (path, line) => batch.get(path)?.feed(line),
      );
      if (!pulled.ok) return { state: "failed", readAt: now(), reason: pulled.reason, detail: pulled.detail };
      const applied = applyFiles(known, [...batch.values()], this.store.zone);
      const stored = (this.store.sources[key] ??= { files: {} });
      Object.assign(stored.files, applied.files);
      changed = applied.changed.length;
    }
    if (listed.files.length || this.store.sources[key]) {
      (this.store.sources[key] ??= { files: {} }).transcriptsReadAt = now();
      this.save();
    }
    return { state: "ok", readAt: now(), files: listed.files.length, read: wanted.length, changed };
  }

  /** Forgets what was read this session. What the store holds is kept. */
  forget(source: Source): void {
    this.rows.delete(sourceKey(source));
    this.live.delete(sourceKey(source));
  }

  status(source: Source): SourceStatus {
    const live = this.liveOf(source);
    const stored = this.store.sources[sourceKey(source)];
    return {
      ...live.history,
      source,
      reading: live.reading,
      storedAt: stored?.prompts?.readAt ?? null,
      transcriptsStoredAt: stored?.transcriptsReadAt ?? null,
      transcripts: live.transcripts,
      keepsLonger: live.keepsLonger,
    };
  }

  /** True when the store holds numbers from an earlier read of this source. */
  hasStored(source: Source): boolean {
    const stored = this.store.sources[sourceKey(source)];
    return stored !== undefined && (stored.prompts !== undefined || Object.keys(stored.files).length > 0);
  }

  /**
   * The numbers from these sources, merged into one timeline. Reads nothing
   * itself. A source read this session is counted from its rows; one that
   * has not been read yet, or could not be, is counted from what the store
   * kept of it. The store keeps a hash of each prompt, so a prompt held by
   * two sources is counted once either way.
   */
  numbers(sources: Source[], zone: string, now = Date.now(), opts: NumbersOptions = {}): Numbers {
    const fresh: SourceRows[] = [];
    const stored: SourceRows[] = [];
    const kept: Span[] = [];
    // Every session a prompt history has a row for, across the sources.
    const held = new Set<string>();
    for (const source of sources) {
      const key = sourceKey(source);
      const rows = this.rows.get(key);
      const prompts = this.store.sources[key]?.prompts;
      for (const session of rows?.sessions ?? prompts?.sessions ?? []) held.add(session);
      if (rows) fresh.push(rows);
      else if (prompts?.rows) stored.push({ rows: rowsOf(prompts), dropped: prompts.dropped, badLines: prompts.badLines });
      else if (prompts?.spans) {
        // Kept by an older version as stretches: right for the hours, but
        // they cannot be told apart from another source's prompts.
        kept.push(...prompts.spans);
        stored.push({ rows: [], dropped: prompts.dropped, badLines: prompts.badLines });
      }
    }

    // A session the prompt histories do not hold has its typed times taken
    // from its transcript. One they do hold is left to them.
    // A source whose history was last read by a version that did not keep
    // its sessions gives none until that history is read again: its
    // sessions cannot yet be told from the history's.
    const files = sources.map((s) => this.store.sources[sourceKey(s)]?.files ?? {});
    const known = sources.filter((s) => {
      const key = sourceKey(s);
      const prompts = this.store.sources[key]?.prompts;
      return this.rows.has(key) || prompts === undefined || prompts.sessions !== undefined;
    });
    const typed = typedRows(known.map((s) => this.store.sources[sourceKey(s)]?.files ?? {}), held);

    // Fresh first: where two sources hold a prompt, the row with its text is kept.
    const merged = mergeSources([...fresh, ...stored, { rows: typed, dropped: 0, badLines: 0 }]);
    const any = fresh.length > 0 || stored.length > 0 || typed.length > 0;
    const report = any
      ? buildReport({ timestamps: merged.timestamps, spans: kept, dropped: merged.dropped, badLines: merged.badLines }, { zone, now })
      : null;

    const promptingHours = new Map<DayKey, number>((report?.days ?? []).map((d) => [d.day, d.hours]));
    const usage = buildUsage(files, { zone, now, promptSpans: spansOf(merged.timestamps).concat(kept), promptingHours });
    const screens = buildScreens({
      report,
      usage,
      rows: merged.rows,
      folderTokens: usage ? folderTokens(files, usage.range.from, usage.range.to) : new Map(),
      zone,
      now,
      planPrice: opts.planPrice,
      hideNames: opts.hideNames,
      locale: opts.locale,
    });
    return { report, usage, screens, readAt: now, duplicates: merged.duplicates, fromTranscripts: typed.length };
  }
}
