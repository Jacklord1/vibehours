// What the app remembers: the sources, the home zone, whether the
// keep-a-year question has been answered, the plan price and whether names
// are hidden, and the week last week's line was last shown for. Never any
// history.

import * as fs from "node:fs";
import * as path from "node:path";
import { dayKeyer } from "../engine/hours";
import type { WeekLineSeen } from "../engine/insights";
import { cleanSource, isSource, sourceKey, type Source } from "./sources";

export interface Settings {
  version: 2;
  /** IANA zone name. Set once from the PC at first run, then fixed. */
  homeZone: string;
  sources: Source[];
  /** Set once the keep-a-year question has had a yes or a no. */
  keepYearAnswer?: "yes" | "no";
  /** What the user's plan costs a month, as they typed it, currency sign and all. */
  planPrice?: string;
  /** Project and source names are replaced on every page. For screenshots. */
  hideNames?: boolean;
  /** The week last week's line was last put up for, and whether it was closed. */
  weekLine?: WeekLineSeen;
}

export interface Loaded {
  settings: Settings;
  /** True when there was no settings file to load. */
  firstRun: boolean;
}

export function isZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone === "") return false;
  try {
    dayKeyer(zone);
    return true;
  } catch {
    return false;
  }
}

function uniqueSources(list: unknown[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of list) {
    if (!isSource(s) || seen.has(sourceKey(s))) continue;
    seen.add(sourceKey(s));
    out.push(cleanSource(s));
  }
  return out;
}

export function loadSettings(dir: string): Loaded {
  let saved: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {
    // No file, or one that cannot be read: this is a first run.
  }
  const homeZone = saved && isZone(saved.homeZone) ? saved.homeZone : new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!saved) return { settings: { version: 2, homeZone, sources: [] }, firstRun: true };

  // v0.1.0 saved one `source`. It becomes a list of one.
  const list = Array.isArray(saved.sources) ? saved.sources : "source" in saved ? [saved.source] : [];
  const settings: Settings = { version: 2, homeZone, sources: uniqueSources(list) };
  if (saved.keepYearAnswer === "yes" || saved.keepYearAnswer === "no") settings.keepYearAnswer = saved.keepYearAnswer;
  if (typeof saved.planPrice === "string" && saved.planPrice.trim() !== "") settings.planPrice = saved.planPrice.trim().slice(0, 24);
  if (saved.hideNames === true) settings.hideNames = true;
  const line = saved.weekLine as Partial<WeekLineSeen> | null | undefined;
  if (line && typeof line === "object" && typeof line.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(line.week)) {
    settings.weekLine = { week: line.week, closed: line.closed === true };
  }
  return { settings, firstRun: false };
}

export function saveSettings(dir: string, settings: Settings): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
}
