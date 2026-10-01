// The offer to keep Claude Code's transcripts for a year.
//
// Claude Code deletes transcripts older than `cleanupPeriodDays`, a
// top-level key in the user settings file `~/.claude/settings.json`. The
// default is 30 days. (Claude Code docs, "claude-directory" and "settings",
// read 2026-10-01.) The file is strict JSON.
//
// This is the only place the app writes outside its own folder. It does so
// only on this PC, only when asked. To a file that is there it adds one key,
// after a copy. Where there is no file it makes one holding that key and
// nothing else: a PC that has only ever used the Claude desktop app has no
// settings file, and its hours reach back only as far as its transcripts.

import * as fs from "node:fs";
import * as path from "node:path";
import { claudeDir } from "./sources";

export const KEY = "cleanupPeriodDays";
export const DAYS = 365;

export type KeepYearState =
  | { state: "can-add" }
  | { state: "no-file" }
  | { state: "not-json" }
  | { state: "not-object" }
  | { state: "has-key"; value: unknown }
  | { state: "unreadable"; detail: string };

export type KeepYearResult =
  /** `backup` is the copy of the file as it was. Null when there was no file and one was made. */
  | { done: true; backup: string | null }
  | { done: false; why: Exclude<KeepYearState["state"], "can-add" | "no-file"> | "write-failed"; value?: unknown; detail?: string };

/** What a new settings file holds: the one key, and nothing else. */
export const NEW_FILE = `{\n  "${KEY}": ${DAYS}\n}\n`;

export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return path.join(claudeDir(env, home), "settings.json");
}

function read(file: string): { text: string } | KeepYearState {
  try {
    return { text: fs.readFileSync(file, "utf8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { state: "no-file" } : { state: "unreadable", detail: code ?? "read failed" };
  }
}

function inspectText(text: string): KeepYearState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { state: "not-json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { state: "not-object" };
  if (Object.hasOwn(parsed, KEY)) return { state: "has-key", value: (parsed as Record<string, unknown>)[KEY] };
  return { state: "can-add" };
}

export function inspectKeepYear(file: string): KeepYearState {
  const got = read(file);
  return "text" in got ? inspectText(got.text) : got;
}

/**
 * The file's text with the one key added straight after the opening brace,
 * in the file's own indent and line endings. Nothing else moves.
 */
export function withKey(text: string): string {
  const open = text.indexOf("{");
  const head = text.slice(0, open + 1);
  const rest = text.slice(open + 1);
  const entry = `"${KEY}": ${DAYS}`;
  if (/^\s*\}/.test(rest)) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    return `${head}${eol}  ${entry}${eol}${rest.trimStart()}`;
  }
  const lead = /^(\r?\n)([ \t]*)/.exec(rest);
  return lead ? `${head}${lead[1]}${lead[2]}${entry},${rest}` : `${head}${entry}, ${rest.trimStart()}`;
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

export function applyKeepYear(file: string, now = new Date()): KeepYearResult {
  const got = read(file);
  if (!("text" in got)) {
    if (got.state !== "no-file") return { done: false, ...refusal(got) };
    // No file: one is made. Never over a file that appeared meanwhile, and
    // never a folder: with no Claude Code folder there is nothing to keep.
    try {
      fs.writeFileSync(file, NEW_FILE, { flag: "wx" });
    } catch (err) {
      return { done: false, why: "write-failed", detail: (err as NodeJS.ErrnoException).code ?? "write failed" };
    }
    return { done: true, backup: null };
  }
  const state = inspectText(got.text);
  if (state.state !== "can-add") return { done: false, ...refusal(state) };

  // Prove the new text is the old settings plus the one key before a byte
  // is written.
  const next = withKey(got.text);
  try {
    const before = JSON.parse(got.text.replace(/^﻿/, "")) as Record<string, unknown>;
    const after = JSON.parse(next.replace(/^﻿/, "")) as Record<string, unknown>;
    const { [KEY]: added, ...others } = after;
    if (added !== DAYS || JSON.stringify(others) !== JSON.stringify(before)) throw new Error("mismatch");
  } catch {
    return { done: false, why: "write-failed", detail: "The change could not be made safely, so nothing was written." };
  }

  const backup = `${file}.before-vibehours-${stamp(now)}`;
  const temp = `${file}.vibehours-tmp`;
  try {
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(temp, next);
    fs.renameSync(temp, file);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    return { done: false, why: "write-failed", detail: (err as NodeJS.ErrnoException).code ?? "write failed" };
  }
  return { done: true, backup };
}

function refusal(state: KeepYearState): { why: Exclude<KeepYearState["state"], "can-add" | "no-file">; value?: unknown; detail?: string } {
  if (state.state === "has-key") return { why: "has-key", value: state.value };
  if (state.state === "unreadable") return { why: "unreadable", detail: state.detail };
  if (state.state === "can-add" || state.state === "no-file") throw new Error("not a refusal");
  return { why: state.state };
}
