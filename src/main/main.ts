import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, session, shell } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyKeepYear,
  claudeSettingsPath,
  inspectKeepYear,
  type KeepYearResult,
  type KeepYearState,
} from "./keepyear";
import { PUBLISHED_COST, weekLine } from "../engine/insights";
import { parsePlanPrice } from "../engine/screens";
import { Session, type Numbers, type SourceStatus } from "./session";
import { isZone, loadSettings, saveSettings, type Settings } from "./settings";
import { cleanSource, isSource, localHistoryPath, localTranscriptsDir, sourceKey, type Source } from "./sources";
import { listSshHosts } from "./sshconfig";
import { loadStore, saveStore, useZone, type Store } from "./store";

export type { SourceStatus };

export interface Found {
  sshConfigPath: string;
  localPath: string;
  localExists: boolean;
  sshHosts: string[];
  /** Linux on a Windows PC (WSL) is not read, and the screen says so there. */
  windows: boolean;
}

export interface AppState {
  firstRun: boolean;
  /** The PC's regional format, for dates and numbers. */
  locale: string;
  homeZone: string;
  /** The plan price as typed, and whether a number could be read from it. Null when none is set. */
  planPrice: { text: string; usable: boolean } | null;
  /** Project and source names are replaced everywhere. */
  hideNames: boolean;
  /** Last week's line is up: the first open of a new week, until it is closed. */
  weekLineOpen: boolean;
  found: Found;
  /** One per chosen source, in the order they were chosen. */
  sources: SourceStatus[];
  /** Sources ticked on the first run that had nothing in them, and so were not kept. */
  empty: SourceStatus[];
  /** The name the app's own store was set aside under, if it could not be read. */
  storeSetAside: string | null;
  /** True when the store could be neither read nor moved, so nothing is being saved. */
  storeLocked: boolean;
  /** Null unless this PC is a chosen source and has Claude Code on it. */
  keepYear: { file: string; now: KeepYearState; answer?: "yes" | "no"; result?: KeepYearResult } | null;
}

export interface LoadResult extends Numbers {
  state: AppState;
}

let settings: Settings;
let firstRun = false;
let found: Found = { sshConfigPath: "", localPath: "", localExists: false, sshHosts: [], windows: false };
let keepYearResult: KeepYearResult | undefined;
let store: Store;
let storeSetAside: string | null = null;
let storeLocked = false;
let reads: Session;
let win: BrowserWindow | undefined;
const empty = new Map<string, SourceStatus>();

function discover(): void {
  const localPath = localHistoryPath();
  found = {
    sshConfigPath: path.join(os.homedir(), ".ssh", "config"),
    localPath,
    // Claude Code is on this PC if it has kept a history or a transcript.
    localExists: fs.existsSync(localPath) || fs.existsSync(localTranscriptsDir()),
    sshHosts: listSshHosts(),
    windows: process.platform === "win32",
  };
  empty.clear();
}

function saveTotals(): void {
  // A first run keeps nothing until the user has chosen and continued.
  if (!firstRun && !storeLocked) saveStore(app.getPath("userData"), store);
}

function persist(): void {
  // A first run saves nothing until the user has chosen and continued.
  if (!firstRun) saveSettings(app.getPath("userData"), settings);
}

// Last week's line comes up the first time the app is opened in a new week.
// What is remembered is the week and whether the line was closed; no clock
// runs for it.
function weekLineOpen(): boolean {
  if (firstRun) return false;
  const seen = weekLine(settings.weekLine, Date.now(), settings.homeZone, false);
  if (seen !== settings.weekLine) {
    settings = { ...settings, weekLine: seen };
    persist();
  }
  return !seen.closed;
}

function closeWeekLine(): AppState {
  if (!firstRun) {
    settings = { ...settings, weekLine: { ...weekLine(settings.weekLine, Date.now(), settings.homeZone, false), closed: true } };
    persist();
  }
  return state();
}

/** The bytes of a PNG the page drew, or null when they are not one. */
function pngBytes(sent: unknown): Buffer | null {
  if (!(sent instanceof Uint8Array) || sent.length < 8 || sent.length > 20_000_000) return null;
  const bytes = Buffer.from(sent.buffer, sent.byteOffset, sent.length);
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? bytes : null;
}

export interface Saved {
  saved: boolean;
  /** Why not, when it was tried and failed. Absent when the user closed the window. */
  error?: string;
}

// The picture goes where the user says, through the normal save window.
async function savePicture(sent: unknown, name: unknown): Promise<Saved> {
  const bytes = pngBytes(sent);
  if (!bytes || !win || win.isDestroyed()) return { saved: false, error: "There was no picture to save." };
  const base = typeof name === "string" && /^[\w-]{1,60}$/.test(name) ? name : "vibehours";
  let folder = os.homedir();
  try {
    folder = app.getPath("pictures");
  } catch {
    // No pictures folder on this PC: the home folder is offered.
  }
  const picked = await dialog.showSaveDialog(win, {
    title: "Save picture",
    defaultPath: path.join(folder, `${base}.png`),
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (picked.canceled || !picked.filePath) return { saved: false };
  try {
    fs.writeFileSync(picked.filePath, bytes);
    return { saved: true };
  } catch (err) {
    return { saved: false, error: (err as NodeJS.ErrnoException).code ?? "the file could not be written" };
  }
}

async function copyPicture(sent: unknown): Promise<{ copied: boolean }> {
  const bytes = pngBytes(sent);
  if (!bytes) return { copied: false };
  try {
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
    return { copied: true };
  } catch {
    return { copied: false };
  }
}

function state(): AppState {
  const hasLocal = settings.sources.some((s) => s.kind === "local");
  const file = claudeSettingsPath();
  return {
    firstRun,
    locale: app.getSystemLocale() || app.getLocale(),
    homeZone: settings.homeZone,
    planPrice: settings.planPrice ? { text: settings.planPrice, usable: parsePlanPrice(settings.planPrice) !== null } : null,
    hideNames: settings.hideNames === true,
    weekLineOpen: weekLineOpen(),
    found,
    sources: settings.sources.map((s) => reads.status(s)),
    empty: [...empty.values()],
    storeSetAside,
    storeLocked,
    // A PC with no Claude Code on it has nothing to keep, so it is not asked.
    keepYear: hasLocal && found.localExists
      ? { file, now: inspectKeepYear(file), answer: settings.keepYearAnswer, result: keepYearResult }
      : null,
  };
}

// The numbers, from whatever was last read. Reads nothing itself.
function report(): LoadResult {
  const opts = { planPrice: settings.planPrice, hideNames: settings.hideNames, locale: app.getSystemLocale() || app.getLocale() };
  return { ...reads.numbers(settings.sources, settings.homeZone, Date.now(), opts), state: state() };
}

// Tells the page there is something new to show: a source has started,
// moved on to its transcripts, or landed.
function push(): void {
  if (win && !win.isDestroyed()) win.webContents.send("vibehours:changed", report());
}

async function refresh(): Promise<LoadResult> {
  await Promise.all(settings.sources.map((s) => reads.read(s, push)));
  return report();
}

function isOffered(source: Source): boolean {
  return source.kind === "local" || found.sshHosts.includes(source.host);
}

/** Nothing there at all: no history and no transcript, and nothing kept from before. */
function hasNothing(source: Source): boolean {
  const status = reads.status(source);
  const noHistory = status.state === "failed" && status.reason === "not-found";
  const noTranscripts = status.transcripts.state === "ok" && status.transcripts.files === 0;
  return noHistory && noTranscripts && !reads.hasStored(source);
}

async function addSource(source: unknown): Promise<AppState> {
  if (!isSource(source) || !isOffered(source)) return state();
  const clean = cleanSource(source);
  if (!settings.sources.some((s) => sourceKey(s) === sourceKey(clean))) {
    settings = { ...settings, sources: [...settings.sources, clean] };
    persist();
  }
  // A source is read once when it is chosen, and only then.
  empty.delete(sourceKey(clean));
  await reads.read(clean);
  // On the first run a source with nothing in it is shown as such and not kept.
  if (firstRun && hasNothing(clean)) {
    empty.set(sourceKey(clean), reads.status(clean));
    settings = { ...settings, sources: settings.sources.filter((s) => sourceKey(s) !== sourceKey(clean)) };
    reads.forget(clean);
  }
  return state();
}

function removeSource(source: unknown): AppState {
  if (!isSource(source)) return state();
  const key = sourceKey(source);
  settings = { ...settings, sources: settings.sources.filter((s) => sourceKey(s) !== key) };
  reads.forget(source);
  persist();
  return state();
}

async function readSource(source: unknown): Promise<AppState> {
  if (isSource(source) && settings.sources.some((s) => sourceKey(s) === sourceKey(source))) {
    await reads.read(cleanSource(source));
  }
  return state();
}

function setZone(zone: unknown): AppState {
  if (isZone(zone)) {
    settings = { ...settings, homeZone: zone };
    persist();
    // Days are cut in the home zone, so the transcripts are read again.
    useZone(store, zone);
    saveTotals();
  }
  return state();
}

function setPlanPrice(text: unknown): AppState {
  if (typeof text === "string") {
    const typed = text.trim().slice(0, 24);
    settings = { ...settings, planPrice: typed === "" ? undefined : typed };
    persist();
  }
  return state();
}

function setHideNames(hide: unknown): AppState {
  settings = { ...settings, hideNames: hide === true ? true : undefined };
  persist();
  return state();
}

function finishFirstRun(): AppState {
  if (settings.sources.length > 0) {
    firstRun = false;
    // A first-ever open shows no line for a week the app was not there for.
    settings = { ...settings, weekLine: weekLine(undefined, Date.now(), settings.homeZone, true) };
    persist();
    saveTotals();
  }
  return state();
}

function answerKeepYear(yes: unknown): AppState {
  // Only where the offer is shown: this PC is a source and has Claude Code on it.
  if (settings.keepYearAnswer || !settings.sources.some((s) => s.kind === "local") || !found.localExists) return state();
  if (yes === true) keepYearResult = applyKeepYear(claudeSettingsPath());
  settings = { ...settings, keepYearAnswer: yes === true ? "yes" : "no" };
  persist();
  return state();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 480,
    minHeight: 480,
    title: "Vibehours",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const opened = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.once("ready-to-show", () => opened.show());
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

void app.whenReady().then(() => {
  ({ settings, firstRun } = loadSettings(app.getPath("userData")));
  ({ store, setAside: storeSetAside, locked: storeLocked } = loadStore(app.getPath("userData"), settings.homeZone));
  reads = new Session(store, undefined, saveTotals);
  Menu.setApplicationMenu(null);

  // The page loads its own files and nothing else.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|devtools):/.test(details.url) });
  });
  // The spell checker fetches its dictionary from Google's servers, past the
  // filter above. Nothing here is spell checked, so it is off and has no
  // language to fetch one for.
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setSpellCheckerLanguages([]);

  discover();

  ipcMain.handle("vibehours:state", () => state());
  ipcMain.handle("vibehours:look-again", () => {
    discover();
    return state();
  });
  ipcMain.handle("vibehours:refresh", () => refresh());
  ipcMain.handle("vibehours:report", () => report());
  ipcMain.handle("vibehours:add-source", (_event, source: unknown) => addSource(source));
  ipcMain.handle("vibehours:remove-source", (_event, source: unknown) => removeSource(source));
  ipcMain.handle("vibehours:read-source", (_event, source: unknown) => readSource(source));
  ipcMain.handle("vibehours:set-zone", (_event, zone: unknown) => setZone(zone));
  ipcMain.handle("vibehours:set-plan-price", (_event, text: unknown) => setPlanPrice(text));
  ipcMain.handle("vibehours:set-hide-names", (_event, hide: unknown) => setHideNames(hide));
  ipcMain.handle("vibehours:close-week-line", () => closeWeekLine());
  // The one link the app has. It opens in the user's browser; the app itself fetches nothing.
  ipcMain.handle("vibehours:open-cost-source", () => shell.openExternal(PUBLISHED_COST.url));
  ipcMain.handle("vibehours:save-picture", (_event, png: unknown, name: unknown) => savePicture(png, name));
  ipcMain.handle("vibehours:copy-picture", (_event, png: unknown) => copyPicture(png));
  ipcMain.handle("vibehours:finish-first-run", () => finishFirstRun());
  ipcMain.handle("vibehours:answer-keep-year", (_event, yes: unknown) => answerKeepYear(yes));

  createWindow();
});

app.on("window-all-closed", () => app.quit());
