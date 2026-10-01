// The app's own store: what each source gave, kept so a day once seen is
// never lost when Claude Code deletes the transcript it came from.
//
// One file, `store.json`, in the app's user-data folder. It holds totals,
// times and names of models, tools and folders. Never prompt or reply text.
//
// For each source it keeps each typed prompt as its time, the folder it was
// typed in and a short hash of its time and text together, and for each
// transcript file what that file gave to each day. The row for a source and
// a day is the sum of its files, made on reading. Keeping it by file is what
// lets a file that has grown be read again without counting it twice, and a
// file that has gone keep what it gave.

import * as fs from "node:fs";
import * as path from "node:path";
import type { PromptRow, Span } from "../engine/hours";
import type { FileTotals } from "../engine/transcripts";

export const STORE_VERSION = 3;
const FILE = "store.json";

export interface StoredPrompts {
  readAt: number;
  /**
   * One per prompt: its time, a short hash of its time and text, and its
   * folder as a place in `folders` (-1 when the history named none). The
   * hash is what lets one box ticked under two names be counted once before
   * either has been read again.
   */
  rows?: [t: number, hash: string, folder: number][];
  folders?: string[];
  /**
   * Version 1 kept stretches only: first, last, how many. A store brought up
   * from it has these until the source is next read.
   */
  spans?: Span[];
  dropped: number;
  badLines: number;
  /**
   * A short hash of every session the history has a row for. Absent until
   * the history has been read by a version that keeps it.
   */
  sessions?: string[];
}

/** A source's prompts as they go into the store. The text does not go. */
export function storedRows(rows: PromptRow[]): Pick<StoredPrompts, "rows" | "folders"> {
  const folders: string[] = [];
  const place = new Map<string, number>();
  const kept = rows.map((r): [number, string, number] => {
    if (r.folder === null) return [r.t, r.hash, -1];
    let at = place.get(r.folder);
    if (at === undefined) {
      at = folders.push(r.folder) - 1;
      place.set(r.folder, at);
    }
    return [r.t, r.hash, at];
  });
  return { rows: kept, folders };
}

/** And back again, with no text. */
export function rowsOf(stored: StoredPrompts): PromptRow[] {
  return (stored.rows ?? []).map(([t, hash, folder]) => ({ t, hash, folder: stored.folders?.[folder] ?? null }));
}

export interface SourceStore {
  /** Absent until the prompt history has been read once. */
  prompts?: StoredPrompts;
  /** Absent until the transcripts have been read once. */
  transcriptsReadAt?: number;
  files: Record<string, FileTotals>;
}

export interface Store {
  version: typeof STORE_VERSION;
  /** The zone the days were cut in. */
  zone: string;
  sources: Record<string, SourceStore>;
}

export interface LoadedStore {
  store: Store;
  /** The name a store that could not be read was set aside under. */
  setAside: string | null;
  /** True when it could not be moved either: nothing may be saved over it. */
  locked: boolean;
}

/** How to bring a store written by an older version up one version. */
export type Upgrades = Record<number, (old: Record<string, unknown>) => Record<string, unknown>>;

// Version 2 keeps each prompt where version 1 kept stretches of them. The
// stretches cannot be turned back into prompts, so they are kept as they are
// and used until the source is read again.
//
// Version 3 keeps, for each transcript, the times a person typed a prompt.
// A file read by version 2 does not have them, so every file still on disk
// is marked to be read again. One that has gone keeps what it gave.
const UPGRADES: Upgrades = {
  1: (old) => ({ ...old, version: 2 }),
  2: (old) => {
    if (isRecord(old.sources)) {
      for (const source of Object.values(old.sources)) {
        if (!isRecord(source) || !isRecord(source.files)) continue;
        for (const file of Object.values(source.files)) if (isRecord(file)) file.size = -1;
      }
    }
    return { ...old, version: 3 };
  },
};

export function emptyStore(zone: string): Store {
  return { version: STORE_VERSION, zone, sources: {} };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStore(v: Record<string, unknown>): boolean {
  if (v.version !== STORE_VERSION || typeof v.zone !== "string" || !isRecord(v.sources)) return false;
  return Object.values(v.sources).every(
    (s) =>
      isRecord(s) &&
      isRecord(s.files) &&
      Object.values(s.files).every((f) => isRecord(f) && typeof f.size === "number" && isRecord(f.days) && Array.isArray(f.ids)) &&
      (s.prompts === undefined || (isRecord(s.prompts) && (Array.isArray(s.prompts.rows) || Array.isArray(s.prompts.spans)))),
  );
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * A store written by an older version is brought up a version at a time. One
 * that cannot be read, is from a newer version, or is from a version there
 * is no step for, is not overwritten: it is renamed and a new one begun.
 */
export function loadStore(dir: string, zone: string, upgrades: Upgrades = UPGRADES, now = new Date()): LoadedStore {
  const file = path.join(dir, FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { store: emptyStore(zone), setAside: null, locked: false };
    text = "";
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Falls through to being set aside.
  }
  if (isRecord(parsed)) {
    let version = parsed.version;
    while (typeof version === "number" && version < STORE_VERSION && upgrades[version]) {
      parsed = upgrades[version](parsed as Record<string, unknown>);
      version = (parsed as Record<string, unknown>).version;
    }
    if (isStore(parsed as Record<string, unknown>)) {
      const store = parsed as unknown as Store;
      // Days are cut at 4am in the home zone. In another zone the files
      // still on disk are read again; a day whose file has gone stays as it
      // was counted.
      useZone(store, zone);
      return { store, setAside: null, locked: false };
    }
  }

  const aside = `store.unreadable-${stamp(now)}.json`;
  try {
    fs.renameSync(file, path.join(dir, aside));
  } catch {
    // Could not even be renamed. It is left where it is and never written.
    return { store: emptyStore(zone), setAside: null, locked: true };
  }
  return { store: emptyStore(zone), setAside: aside, locked: false };
}

/** Written beside itself first, then moved into place, so a crash leaves the old one whole. */
export function saveStore(dir: string, store: Store): void {
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `${FILE}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(store));
  fs.renameSync(temp, path.join(dir, FILE));
}

/** Marks every file to be read again, after the home zone has changed. */
export function useZone(store: Store, zone: string): void {
  if (store.zone === zone) return;
  for (const source of Object.values(store.sources)) for (const f of Object.values(source.files)) f.size = -1;
  store.zone = zone;
}
