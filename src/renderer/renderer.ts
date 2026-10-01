// The page. It has no Node and no network: everything it shows comes from
// the shell through `window.vibehours`: times, counts, names of models,
// tools and projects, and the words counted on the Prompts page.
//
// This file is the frame, the Overview and Settings. The charts are in
// charts.ts and the other pages in pages.ts; all three are plain scripts
// that share the page's one scope.

type HoursReport = import("../engine/hours").Report;
type Headline = import("../engine/hours").Headline;
type Run = import("../engine/hours").Run;
type UsageReport = import("../engine/transcripts").UsageReport;
type Source = import("../main/sources").Source;
type AppState = import("../main/main").AppState;
type SourceStatus = import("../main/session").SourceStatus;
type LoadResult = import("../main/main").LoadResult;

interface Api {
  state(): Promise<AppState>;
  lookAgain(): Promise<AppState>;
  refresh(): Promise<LoadResult>;
  report(): Promise<LoadResult>;
  addSource(source: Source): Promise<AppState>;
  removeSource(source: Source): Promise<AppState>;
  readSource(source: Source): Promise<AppState>;
  setZone(zone: string): Promise<AppState>;
  setPlanPrice(text: string): Promise<AppState>;
  setHideNames(hide: boolean): Promise<AppState>;
  closeWeekLine(): Promise<AppState>;
  openCostSource(): Promise<void>;
  savePicture(png: Uint8Array, name: string): Promise<import("../main/main").Saved>;
  copyPicture(png: Uint8Array): Promise<{ copied: boolean }>;
  finishFirstRun(): Promise<AppState>;
  answerKeepYear(yes: boolean): Promise<AppState>;
  onChanged(show: (result: LoadResult) => void): void;
}

// Put there by the preload script.
const api = (window as unknown as { vibehours: Api }).vibehours;

const KEEP_LINE = '"cleanupPeriodDays": 365';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
}

type Page = "overview" | "time" | "tokens" | "agent" | "prompts" | "projects";
const PAGES: { id: Page; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "time", title: "Time" },
  { id: "tokens", title: "Tokens" },
  { id: "agent", title: "Agent" },
  { id: "prompts", title: "Prompts" },
  { id: "projects", title: "Projects" },
];

const mainView = el("view-main");
const setupView = el("view-setup");
const navBar = el("nav");
const pagesBox = el("pages");
const refreshButton = el<HTMLButtonElement>("refresh");
const settingsButton = el<HTMLButtonElement>("open-settings");
const periodLine = el("period");
const quietLine = el("quiet");
const messageBox = el("message");
const statsSection = el("stats");
const usageSection = el("usage");
const choicesList = el("choices");
const zoneSelect = el<HTMLSelectElement>("zone");
const doneButton = el<HTMLButtonElement>("setup-done");
const lookAgainButton = el<HTMLButtonElement>("look-again");
const planInput = el<HTMLInputElement>("plan-price");
const hideBox = el<HTMLInputElement>("hide-names");

let state: AppState;
// The page being looked at, and the numbers it was last drawn from.
let page: Page = "overview";
let shown: LoadResult | null = null;
let drawnWidth = 0;
// Set once the home zone has been changed since the app opened.
let zoneChanged = false;
// Set until the transcripts have been read again in the new zone.
let zoneStale = false;
// Dates and numbers follow the PC's regional format, not its display language.
let locale: string | undefined;
// Sources being read right now, by key.
const reading = new Set<string>();

function setBusy(busy: boolean): void {
  document.body.dataset.busy = busy ? "1" : "0";
}

function useLocale(tag: string): void {
  try {
    locale = Intl.DateTimeFormat.supportedLocalesOf([tag])[0];
  } catch {
    locale = undefined;
  }
}

function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    Date.UTC(y, m - 1, d),
  );
}

// Times and the days they fall on are always shown in the home zone.
function fmtInstantDay(ms: number): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: state.homeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(ms);
}

function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat(locale, { timeZone: state.homeZone, hour: "numeric", minute: "2-digit" }).format(ms);
}

function fmtCount(n: number): string {
  return n.toLocaleString(locale);
}

function fmtNumber(n: number, digits = 1): string {
  return n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Token counts run to billions; three figures are enough to read.
function fmtBig(n: number): string {
  return n.toLocaleString(locale, { notation: "compact", maximumSignificantDigits: 3 });
}

// Claude Code keeps its cost in US dollars, and it is shown as such everywhere.
function fmtDollars(n: number): string {
  return n.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** A time, with its day when that is not today. */
function fmtWhen(ms: number): string {
  return fmtInstantDay(ms) === fmtInstantDay(Date.now()) ? fmtTime(ms) : `${fmtTime(ms)} on ${fmtInstantDay(ms)}`;
}

function plural(n: number, word: string): string {
  return `${fmtCount(n)} ${word}${n === 1 ? "" : "s"}`;
}

function fmtRun(run: Run): string {
  return run.from === run.to ? fmtDay(run.from) : `${fmtDay(run.from)} to ${fmtDay(run.to)}`;
}

function fmtList(items: string[]): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}

function keyOf(s: Source): string {
  return s.kind === "ssh" ? `ssh:${s.host}` : "local";
}

// With names hidden a source is known by its place in the list, and nothing
// that could name a machine or a person is written out.
function nameOf(s: Source, startOfSentence = false): string {
  if (state.hideNames) {
    const at = state.sources.findIndex((c) => keyOf(c.source) === keyOf(s));
    return at >= 0 ? `Source ${at + 1}` : startOfSentence ? "A source" : "a source";
  }
  if (s.kind === "ssh") return s.host;
  return startOfSentence ? "This PC" : "this PC";
}

function pathText(path: string): string {
  return state.hideNames ? "a file on this PC" : path;
}

function paragraphs(box: HTMLElement, lines: string[], detail: string[] = []): void {
  box.replaceChildren(...lines.map((t) => node("p", "", t)), ...detail.map((t) => node("p", "detail", t)));
  box.hidden = false;
}

// ---------------------------------------------------------------- main view

/** `value` null means there is nothing to show, and `sub` says why. */
function tile(label: string, value: string | null, unit: string, sub: string, none = "Not enough history"): HTMLElement {
  const wrap = node("div", "tile");
  const dd = node("dd");
  const v = node("div", value === null ? "value none" : "value", value ?? none);
  if (value !== null && unit) v.append(node("span", "unit", unit));
  dd.append(v, node("div", "sub", sub));
  wrap.append(node("dt", "", label), dd);
  return wrap;
}

function renderStats(report: HoursReport, h: Headline, duplicates: number, fromTranscripts: number): void {
  const perWeekNote = "Needs a week of history";
  el("headline").replaceChildren(
    tile(
      "Days a week",
      h.daysPerWeek === null ? null : fmtNumber(h.daysPerWeek),
      "",
      h.daysPerWeek === null ? perWeekNote : `${fmtCount(h.activeDays)} active days of ${fmtCount(h.totalDays)}`,
    ),
    tile(
      "Big days a week",
      h.bigDaysPerWeek === null ? null : fmtNumber(h.bigDaysPerWeek),
      "",
      h.bigDaysPerWeek === null ? perWeekNote : `${plural(h.bigDays, "big day")} in all`,
    ),
    tile(
      "Typical big day",
      h.typicalBigDay === null ? null : fmtNumber(h.typicalBigDay),
      "h",
      h.typicalBigDay === null ? "No big day yet" : "Median of your big days",
    ),
    tile("Median active day", fmtNumber(h.medianActiveDay), "h", "Half your active days are longer"),
    tile(
      "Weekly hours",
      h.weeklyHours === null ? null : fmtNumber(h.weeklyHours),
      "h",
      h.weeklyHours === null ? perWeekNote : `${fmtNumber(h.totalHours, 0)} prompting hours in all`,
    ),
    tile("Peak day", fmtNumber(h.peak.hours), "h", fmtDay(h.peak.day)),
  );

  el("streaks").replaceChildren(
    tile(
      "Current streak",
      fmtCount(h.currentStreak),
      h.currentStreak === 1 ? "day" : "days",
      h.currentStreak === 0 ? "No prompts yesterday or today" : "Days in a row, up to today",
    ),
    tile("Longest streak", fmtCount(h.longestStreak.days), h.longestStreak.days === 1 ? "day" : "days", fmtRun(h.longestStreak)),
    h.longestBreak
      ? tile("Longest break", fmtCount(h.longestBreak.days), h.longestBreak.days === 1 ? "day" : "days", fmtRun(h.longestBreak))
      : tile("Longest break", "0", "days", "Not one day off"),
  );

  const notes = [`${plural(h.prompts, "prompt")} counted.`];
  if (fromTranscripts) {
    notes.push(
      fromTranscripts >= h.prompts
        ? "There is no terminal prompt history, so the times you typed are taken from your transcripts and reach back as far as they do."
        : `${plural(fromTranscripts, "prompt")} ${fromTranscripts === 1 ? "was" : "were"} typed in sessions the prompt history does not hold; their times are taken from the transcripts.`,
    );
  }
  if (duplicates) {
    const was = duplicates === 1 ? "was" : "were";
    notes.push(`${plural(duplicates, "prompt")} ${was} in more than one source and ${was} counted once.`);
  }
  if (report.badLines) {
    const was = report.badLines === 1 ? "was" : "were";
    notes.push(`${plural(report.badLines, "line")} in the history could not be read and ${was} left out.`);
  }
  el("totals").textContent = notes.join(" ");
  statsSection.hidden = false;
}

// The block for the days the transcripts cover. Session hours are the
// headline, and they cannot reach back past the first transcript, so the
// heading says where they start.
function renderUsage(u: UsageReport): void {
  const perWeekNote = "Needs a week of transcripts";
  const all = u.tokens[0] + u.tokens[1] + u.tokens[2] + u.tokens[3];
  el("usage-title").textContent = `Since ${fmtDay(u.range.from)}, from transcripts`;
  el("usage-tiles").replaceChildren(
    tile(
      "Session hours a week",
      u.sessionHoursPerWeek === null ? null : fmtNumber(u.sessionHoursPerWeek),
      "h",
      u.sessionHoursPerWeek === null ? perWeekNote : `${fmtNumber(u.sessionHours, 0)} hours in all, agent work included`,
    ),
    tile(
      "Agent hours a week",
      u.agentHoursPerWeek === null ? null : fmtNumber(u.agentHoursPerWeek),
      "h",
      u.agentHoursPerWeek === null ? perWeekNote : "It worked while you were not typing",
    ),
    tile(
      "Most sessions at once",
      u.mostAtOnce ? fmtCount(u.mostAtOnce.sessions) : null,
      "",
      u.mostAtOnce ? fmtDay(u.mostAtOnce.day) : "",
      "No session yet",
    ),
    tile("Tokens in all", fmtBig(all), "", "Including cache reads"),
    tile("Output tokens", fmtBig(u.tokens[1]), "", "What the model wrote"),
    tile(
      "List-price value",
      u.cost === null ? null : fmtDollars(u.cost),
      "",
      u.cost === null
        ? "Claude Code kept no cost for these sessions"
        : u.sessionsWithoutCost
          ? `${fmtCount(u.sessionsWithoutCost)} of ${plural(u.sessions, "session")} kept no cost and are left out`
          : "Claude Code's own figure",
      "No cost kept",
    ),
  );

  const notes = [
    `Session hours count the time a session was live. They start on ${fmtDay(u.range.from)}, the first day ` +
      "Claude Code still has a transcript for; older hours are not scaled up to match.",
  ];
  if (u.unattended.runs) {
    const are = u.unattended.runs === 1 ? "is" : "are";
    notes.push(
      `${plural(u.unattended.runs, "unattended run")} (${fmtNumber(u.unattended.hours)} h) ${are} left out of the hours.`,
    );
  }
  notes.push(TOKEN_NOTE);
  el("usage-note").textContent = notes.join(" ");
  usageSection.hidden = false;
}

// This week so far, from Sunday, beside the whole weeks before it. Prompting
// hours, because they are the one measure every week in the history has.
function renderWeek(week: Screens["week"]): void {
  const section = el("week");
  section.hidden = week === null;
  if (!week) return;
  const avg = week.average;
  const none = "No whole week of history yet";
  const ahead = avg ? week.hours - avg.hoursByNow : 0;
  el("week-title").textContent = `This week so far, from ${weekdayName(0, "long")} ${fmtDayShort(week.weekStart)}`;
  el("week-tiles").replaceChildren(
    tile(
      "Days used",
      fmtCount(week.activeDays),
      `of ${fmtCount(week.daysSoFar)} so far`,
      avg ? `You average ${fmtNumber(avg.activeDays)} in a whole week` : none,
    ),
    tile("Hours", fmtNumber(week.hours), "h", avg ? `You average ${fmtNumber(avg.hours)} h in a whole week` : none),
    tile(
      "Against your average",
      avg ? `${ahead < -0.05 ? "\u2212" : ahead > 0.05 ? "+" : ""}${fmtNumber(Math.abs(ahead))}` : null,
      "h",
      avg ? `By the end of a ${weekdayName(week.daysSoFar - 1, "long")} you have usually done ${fmtNumber(avg.hoursByNow)} h` : none,
    ),
  );
  el("week-note").textContent =
    "Prompting hours, so this week can sit beside every week in your history." +
    (avg ? ` The average is of the ${plural(avg.weeks, "whole week")} before this one.` : "");
}

function renderRecords(r: Screens["records"], result: LoadResult): void {
  const section = el("records");
  section.hidden = !r.biggestDay && !r.longestSession;
  if (section.hidden) return;
  const needs = "Needs transcripts";
  el("record-tiles").replaceChildren(
    tile("Biggest day", r.biggestDay ? fmtNumber(r.biggestDay.hours) : null, "h", r.biggestDay ? fmtDay(r.biggestDay.day) : "", "No history"),
    tile(
      "Busiest week",
      r.busiestWeek ? fmtNumber(r.busiestWeek.hours) : null,
      "h",
      r.busiestWeek ? `Week of ${fmtDay(r.busiestWeek.weekStart)}, ${plural(r.busiestWeek.activeDays, "day")} used` : "",
      "No history",
    ),
    tile(
      "Longest session",
      r.longestSession ? fmtNumber(r.longestSession.hours) : null,
      "h",
      r.longestSession ? `Began ${fmtDay(r.longestSession.day)}` : "",
      needs,
    ),
    tile(
      "Biggest token day",
      r.biggestTokenDay ? fmtBig(r.biggestTokenDay.tokens) : null,
      "",
      r.biggestTokenDay ? fmtDay(r.biggestTokenDay.day) : "",
      needs,
    ),
  );
  el("records-note").textContent =
    "Biggest day and busiest week are prompting hours, from all your history. " +
    (result.usage
      ? `Longest session is one session with no gap over 30 minutes; it and the biggest token day are from transcripts, since ${fmtDay(result.usage.range.from)}.`
      : "Longest session and biggest token day come from transcripts, and none has been read.");
}

// The style label sits beside the page's name, on the Overview only.
function renderLabel(label: Screens["label"] | null): void {
  el("label-name").hidden = label === null;
  el("label-why").hidden = label === null;
  if (!label) return;
  el("label-name").textContent = label.name;
  el("label-why").textContent = label.why;
}

// Last week in one line. It is put up only once every source has been read
// this time: a week counted from what the store held could say less than
// was done.
function renderLastWeek(result: LoadResult): void {
  const last = result.screens.lastWeek;
  const read = state.sources.every((s) => s.reading === null && !["failing", "unread"].includes(sourceCase(s)));
  el("last-week").hidden = !(state.weekLineOpen && last && read);
  if (last) el("last-week-text").textContent = last.text;
}

function renderInsights(lines: Screens["insights"]): void {
  el("insights").hidden = lines.length === 0;
  el("insight-lines").replaceChildren(...lines.map((line) => node("li", "", line.text)));
}

// The month last picked for a card, kept while the page is drawn again.
let pickedMonth = "";

function renderShare(screens: Screens): void {
  el("share").hidden = screens.share === null;
  const pick = el<HTMLSelectElement>("month-pick");
  // The last month that has ended is the one offered first.
  if (!screens.months.some((m) => m.month === pickedMonth)) pickedMonth = (screens.months.find((m) => !m.soFar) ?? screens.months[0])?.month ?? "";
  pick.replaceChildren(
    ...screens.months.map((m) => {
      const o = node("option", "", m.name);
      o.value = m.month;
      return o;
    }),
  );
  pick.value = pickedMonth;
  el("month-open").parentElement!.hidden = screens.months.length === 0;
}

const cardDialog = el<HTMLDialogElement>("card-dialog");
const cardCanvas = el<HTMLCanvasElement>("card-canvas");
// The name offered for the file. Never a name of the user's.
let cardFile = "vibehours";

// The picture is shown before anything is saved or copied.
function openCard(card: Card, title: string, file: string): void {
  hideTip();
  drawCard(cardCanvas, card);
  cardFile = file;
  el("card-title").textContent = title;
  el("card-status").textContent = "";
  if (!cardDialog.open) cardDialog.showModal();
}

function cardBytes(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    cardCanvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)));
    }, "image/png");
  });
}

async function saveCard(): Promise<void> {
  const bytes = await cardBytes();
  const done = bytes ? await api.savePicture(bytes, cardFile) : { saved: false, error: "the picture could not be made" };
  el("card-status").textContent = done.saved ? "Saved." : done.error ? `Not saved: ${done.error}.` : "";
}

async function copyCard(): Promise<void> {
  const bytes = await cardBytes();
  const done = bytes ? await api.copyPicture(bytes) : { copied: false };
  el("card-status").textContent = done.copied ? "Copied. Paste it where you want it." : "It could not be copied.";
}

type Failed = Extract<SourceStatus, { state: "failed" }>;

// The sentences about a source are in words.ts; this gives them the page's formats.
function wordsFormats(): WordsFormats {
  return { when: fmtWhen, time: fmtTime, day: fmtInstantDay, count: fmtCount, hideNames: state.hideNames, windows: state.found.windows };
}

/** Nothing there and never was: said on the settings screen, never warned about here. */
function hasNothing(s: SourceStatus): boolean {
  return sourceCase(s) === "nothing";
}

function renderMain(result: LoadResult): void {
  state = result.state;
  shown = result;
  renderStatus(result);
  renderPage();
}

// The lines above every page: what the numbers are from, what is still on
// its way, and anything that makes them doubtful.
function renderStatus(result: LoadResult): void {
  messageBox.hidden = true;
  periodLine.textContent = "";
  quietLine.textContent = "";

  if (state.sources.length === 0) {
    paragraphs(messageBox, ["No source is chosen, so there is nothing to count.", "Open Settings to choose one."]);
    return;
  }

  const reading = state.sources.filter((s) => s.reading !== null);
  // A source with transcripts and no prompt history was read: it is not among these.
  const failed = state.sources.filter((s): s is SourceStatus & Failed => s.reading === null && s.state === "failed" && sourceCase(s) === "failing");
  // Numbers kept from an earlier read stand in for a source that could not be read now.
  const kept = (s: SourceStatus) => s.storedAt ?? s.transcriptsStoredAt;
  const stale = failed.filter((s) => kept(s) !== null && s.reason !== "changed");
  const leftOut = failed.filter((s) => kept(s) === null && s.reason !== "changed");
  const changed = failed.filter((s) => s.reason === "changed");
  const counted = state.sources.filter(isCounted);
  const { report, usage } = result;

  // The amber box: what the numbers lack, and anything that makes them doubtful.
  const lines: string[] = [];
  const detail: string[] = [];
  if (state.storeSetAside) {
    lines.push(
      `Vibehours could not read its own saved totals, so it set that file aside as ${state.storeSetAside} and started again.`,
    );
    detail.push("Days whose transcripts Claude Code has already deleted cannot be counted again.");
  } else if (state.storeLocked) {
    lines.push("Vibehours could not read its own saved totals, and could not move the file out of the way. Nothing is being saved.");
  }
  const changedFiles = state.sources.filter((s) => s.transcripts.state === "ok" && s.transcripts.changed > 0);
  if (changed.length || changedFiles.length) {
    lines.push(FORMAT_CHANGED);
    for (const s of changed) {
      const from = kept(s) === null ? "" : ` Its numbers are the ones read at ${fmtWhen(kept(s) as number)}.`;
      detail.push(`${nameOf(s.source, true)}: ${failureText(s, wordsFormats())}${from}`);
    }
    for (const s of changedFiles) {
      if (s.transcripts.state !== "ok") continue;
      detail.push(`${nameOf(s.source, true)}: ${plural(s.transcripts.changed, "transcript")} could not be read and ${s.transcripts.changed === 1 ? "was" : "were"} left out.`);
    }
  }
  if (!report && !usage && reading.length === 0) {
    const none = noNumbersText(state.sources, (s) => nameOf(s.source, true), wordsFormats());
    lines.push(none.line);
    detail.push(...none.detail);
  } else if (leftOut.length) {
    lines.push(`These numbers leave out ${fmtList(leftOut.map((s) => nameOf(s.source)))}.`);
    for (const s of leftOut) detail.push(`${nameOf(s.source, true)}: ${failureText(s, wordsFormats())}`);
  }
  if (lines.length) paragraphs(messageBox, lines, detail);

  // One quiet line for what is still on its way, and for what could not be
  // read this time but is shown from before.
  const quiet: string[] = [];
  for (const s of reading) {
    const name = nameOf(s.source);
    if (s.reading === "history") {
      quiet.push(
        s.storedAt === null
          ? `Reading ${name}…`
          : `Reading ${name}… Until it lands, its numbers are the ones read at ${fmtWhen(s.storedAt)}.`,
      );
    } else {
      quiet.push(
        s.transcriptsStoredAt === null
          ? `Reading transcripts from ${name}… The first time can take a minute.`
          : `Reading transcripts from ${name}… Until they land, its tokens and session hours are the ones read at ${fmtWhen(s.transcriptsStoredAt)}.`,
      );
    }
  }
  for (const s of stale) {
    quiet.push(staleText(s, nameOf(s.source, foundNothing(s) ? false : true), wordsFormats()));
  }
  for (const s of state.sources) {
    if (s.reading === null && s.state !== "failed" && s.transcripts.state === "failed") {
      const why = s.source.kind === "ssh" ? sshSaid(s.transcripts.detail, wordsFormats()) : state.hideNames ? "" : s.transcripts.detail;
      quiet.push(`The transcripts on ${nameOf(s.source)} could not be read just now. ${why}`.trim());
    }
  }
  quietLine.textContent = quiet.join(" ");

  if (!report) return;
  const names = fmtList(counted.map((s) => nameOf(s.source)));
  if (!report.range || !report.headline) {
    if (reading.length === 0 && !lines.length) {
      paragraphs(messageBox, [`The history on ${names} has no prompts in it yet, so there is nothing to count.`]);
    }
    return;
  }
  const allFresh = reading.length === 0 && stale.length === 0 && changed.length === 0;
  periodLine.textContent =
    `Prompting hours from ${names}, ${fmtDay(report.range.from)} to ${fmtDay(report.range.to)} ` +
    `(${plural(report.headline.totalDays, "day")}).${allFresh ? ` Read at ${fmtTime(result.readAt)}.` : ""}`;
}

function renderOverview(result: LoadResult): void {
  statsSection.hidden = true;
  usageSection.hidden = true;
  renderLastWeek(result);
  renderInsights(result.screens.insights);
  renderShare(result.screens);
  renderWeek(result.screens.week);
  renderRecords(result.screens.records, result);
  if (result.usage) renderUsage(result.usage);
  if (result.report?.headline) renderStats(result.report, result.report.headline, result.duplicates, result.fromTranscripts);
}

// Draws the page being looked at from the numbers last sent. The charts are
// drawn at the width the page has, so this runs again when that changes.
function renderPage(): void {
  hideTip();
  el("page-title").textContent = PAGES.find((p) => p.id === page)?.title ?? "";
  for (const p of PAGES) {
    el(`page-${p.id}`).hidden = p.id !== page;
    const item = el(`nav-${p.id}`);
    if (p.id === page && setupView.hidden) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  renderLabel(page === "overview" && shown && state.sources.length ? shown.screens.label : null);
  if (setupView.hidden) settingsButton.removeAttribute("aria-current");
  else settingsButton.setAttribute("aria-current", "page");
  if (!shown || mainView.hidden) return;
  drawnWidth = pagesBox.clientWidth;
  if (page === "overview") return renderOverview(shown);
  const draw = { time: renderTime, tokens: renderTokens, agent: renderAgent, prompts: renderPrompts, projects: renderProjects }[page];
  el(`page-${page}`).replaceChildren(...(state.sources.length ? draw(shown, drawnWidth) : []));
}

function showMain(): void {
  setupView.hidden = true;
  mainView.hidden = false;
  navBar.hidden = false;
}

// Shows what the store holds at once, then each source as it lands.
async function refresh(): Promise<void> {
  setBusy(true);
  refreshButton.disabled = true;
  settingsButton.disabled = true;
  try {
    renderMain(await api.refresh());
  } finally {
    refreshButton.disabled = false;
    settingsButton.disabled = false;
    setBusy(false);
  }
}

// ------------------------------------------------- first run and settings

interface Choice {
  source: Source;
  /** What it is, in a few words. */
  kind: string;
  /** Shown until the source is chosen. */
  idle: string;
}

function choices(): Choice[] {
  const chosen = state.sources.map((s) => s.source);
  const has = (s: Source) => chosen.some((c) => keyOf(c) === keyOf(s));
  const list: Choice[] = [];
  const local: Source = { kind: "local" };
  if (state.found.localExists || has(local)) {
    list.push({ source: local, kind: "Claude Code on this PC", idle: pathText(state.found.localPath) });
  }
  const hosts = [...state.found.sshHosts];
  for (const c of chosen) if (c.kind === "ssh" && !hosts.includes(c.host)) hosts.push(c.host);
  for (const host of hosts) {
    list.push({
      source: { kind: "ssh", host },
      kind: "From your SSH config",
      idle: "Not connected to until you tick it.",
    });
  }
  return list;
}

function choiceRow(choice: Choice, index: number): HTMLElement {
  const key = keyOf(choice.source);
  const status = state.sources.find((s) => keyOf(s.source) === key);
  const row = node("li", "choice");
  const label = node("label");
  const box = node("input");
  box.type = "checkbox";
  box.id = `choice-${index}`;
  box.checked = status !== undefined || reading.has(key);
  box.disabled = reading.size > 0;
  box.addEventListener("change", () => void toggle(choice.source, box.checked));
  // A host from the SSH config is a name too, ticked or not.
  const name = state.hideNames && !status ? (choice.source.kind === "ssh" ? `SSH host ${index + 1}` : "This PC") : nameOf(choice.source, true);
  label.append(box, node("span", "name", name), node("span", "kind", choice.kind));
  row.append(label);

  if (reading.has(key)) {
    row.append(node("div", "status", "Reading…"));
  } else if (!status) {
    // Ticked on the first run, found empty, and so not kept.
    const was = state.empty.find((s) => keyOf(s.source) === key);
    row.append(node("div", "status", was && was.state === "failed" ? `Nothing to count there. ${failureText(was, wordsFormats())}` : choice.idle));
  } else {
    const { text, bad } = statusText(status, wordsFormats());
    row.append(node("div", bad ? "status bad" : "status", text));
    const again = node("button", "", "Read again");
    again.type = "button";
    again.disabled = reading.size > 0;
    again.addEventListener("click", () => void readAgain(choice.source));
    row.append(again);
  }
  return row;
}

function refusalText(why: string, value: unknown, detail: string | undefined): string {
  if (why === "not-json") return "Claude Code's settings file is not valid JSON, so Vibehours will not touch it.";
  if (why === "not-object") return "Claude Code's settings file is not in the shape expected, so Vibehours will not touch it.";
  if (why === "has-key") return `The file already sets cleanupPeriodDays, to ${JSON.stringify(value)}. Vibehours left it alone.`;
  if (why === "unreadable") return `Claude Code's settings file could not be read (${detail ?? "unknown"}).`;
  return detail ?? "The file could not be written.";
}

// True whatever Claude Code does with its own files: the store keeps what was read.
const KEPT_ANYWAY = "Either way, Vibehours keeps the totals it has read, so opening it at least once a month loses nothing.";

function renderKeepYear(): void {
  const box = el("keep-year");
  const k = state.keepYear;
  box.hidden = true;
  if (!k) return;
  const fine = (...parts: (string | Node)[]) => {
    const p = node("p", "fine");
    p.append(...parts);
    return p;
  };

  if (k.result) {
    if (k.result.done && k.result.backup === null) {
      // A file was made. What is said is what was done, not what Claude Code will then do.
      box.replaceChildren(
        node("p", "", "Done. A new settings file asks Claude Code to keep transcripts for a year."),
        fine("Vibehours made ", pathText(k.file), " holding one line, ", node("code", "", KEEP_LINE), ", and nothing else. To undo it, delete that file."),
        fine(KEPT_ANYWAY),
      );
    } else if (k.result.done) {
      box.replaceChildren(
        node("p", "", "Done. Claude Code on this PC now keeps its transcripts for a year."),
        fine("One line was added to ", pathText(k.file), ". A copy of the file as it was is at ", pathText(k.result.backup ?? "")),
      );
    } else {
      box.replaceChildren(
        node("p", "", "Nothing was changed."),
        fine(refusalText(k.result.why, k.result.value, k.result.detail)),
      );
    }
    box.hidden = false;
    return;
  }
  if (k.answer || k.now.state === "has-key") return;

  if (k.now.state === "can-add" || k.now.state === "no-file") {
    const yes = node("button", "primary", "Yes, keep a year");
    const no = node("button", "", "No");
    yes.type = no.type = "button";
    yes.id = "keep-yes";
    no.id = "keep-no";
    yes.addEventListener("click", () => void answerKeepYear(true));
    no.addEventListener("click", () => void answerKeepYear(false));
    const actions = node("div", "actions");
    actions.append(yes, no);
    box.replaceChildren(
      node("p", "", "Keep your Claude Code transcripts for a year?"),
      fine(
        "Claude Code deletes its session transcripts after 30 days. Vibehours counts tokens, cost and " +
          "session hours from them, and you may not open this app that often.",
      ),
      k.now.state === "no-file"
        ? fine(
            "Claude Code has no settings file on this PC yet. On yes, Vibehours makes a new file, ",
            pathText(k.file),
            ", holding one line, ",
            node("code", "", KEEP_LINE),
            ", and nothing else. That is the setting Claude Code uses for this. On no, you are not asked again.",
          )
        : fine(
            "On yes, Vibehours copies ",
            pathText(k.file),
            " to a file beside it, then adds one line, ",
            node("code", "", KEEP_LINE),
            ", and changes nothing else. On no, you are not asked again.",
          ),
      fine(KEPT_ANYWAY),
      actions,
    );
    box.hidden = false;
    return;
  }
  box.replaceChildren(
    node("p", "", "Claude Code deletes its session transcripts after 30 days unless told otherwise."),
    fine(
      "Vibehours can change that for you, but not here. ",
      refusalText(k.now.state, undefined, "detail" in k.now ? k.now.detail : undefined),
    ),
    fine("To do it by hand, add ", node("code", "", KEEP_LINE), " to ", pathText(k.file)),
  );
  box.hidden = false;
}

function renderSetup(): void {
  const first = state.firstRun;
  const list = choices();
  el("setup-title").textContent = !first ? "Settings" : list.length ? "Here is what Vibehours found" : "Vibehours found nothing to read yet";
  const lead = el("setup-lead");
  lead.hidden = list.length === 0;
  lead.textContent = first
    ? "Tick what to count. Ticked sources are added together, and time on two at once counts once."
    : "Sources. Ticked ones are added together, and time on two at once counts once.";
  choicesList.replaceChildren(...list.map(choiceRow));

  const nothing = el("nothing");
  nothing.hidden = true;
  if (list.length === 0) {
    const looked = [
      `Claude Code's prompt history on this PC, at ${pathText(state.found.localPath)}, and its transcripts beside it.`,
      `Other machines listed in your SSH config, at ${pathText(state.found.sshConfigPath)}, to read Claude Code's history from them.`,
    ];
    paragraphs(nothing, ["It looks for:"], [
      ...looked,
      "If you use Claude Code on this PC, in a terminal or in the Claude desktop app, type a prompt in it, then press Look again.",
    ]);
  } else if (!state.found.localExists && !state.sources.some((s) => s.source.kind === "local")) {
    paragraphs(nothing, ["No Claude Code prompt history or transcripts were found on this PC itself."], [`Looked for ${pathText(state.found.localPath)} and for transcripts beside it.`]);
  }

  // Said only for a box that was asked and does not have the setting.
  const remote = state.sources.filter((s) => s.keepsLonger === false).map((s) => nameOf(s.source));
  const remoteNote = el("remote-note");
  remoteNote.hidden = remote.length === 0;
  remoteNote.replaceChildren(
    `Claude Code on ${fmtList(remote)} deletes its transcripts after 30 days. To keep a year, add `,
    node("code", "", KEEP_LINE),
    " to ~/.claude/settings.json there. Vibehours will not do it for you.",
  );
  el("wsl-note").hidden = !state.found.windows;

  renderKeepYear();

  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(state.homeZone)) zones.unshift(state.homeZone);
  zoneSelect.replaceChildren(
    ...zones.map((z) => {
      const o = node("option", "", z);
      o.value = z;
      return o;
    }),
  );
  zoneSelect.value = state.homeZone;
  el("zone-note").textContent = first
    ? "Taken from this PC. Days end at 4am in this zone, so change it if it is not where you live."
    : "Days end at 4am in this zone." +
      (zoneChanged ? " Days older than the transcripts still on disk keep the cut they had in the old zone." : "");

  // The plan price and the names switch belong to an app that is set up.
  el("more-settings").hidden = first;
  if (document.activeElement !== planInput) planInput.value = state.planPrice?.text ?? "";
  el("plan-note").textContent =
    state.planPrice && !state.planPrice.usable
      ? "That does not read as a price. Type a number, with its currency sign if you like."
      : "What your plan costs a month, with its currency sign as you would write it. It is shown beside the list-price " +
        "value on the Tokens page. No currency is assumed and nothing is converted.";
  el("plan-note").className = state.planPrice && !state.planPrice.usable ? "note bad" : "note";
  hideBox.checked = state.hideNames;

  doneButton.textContent = first ? "Continue" : "Done";
  doneButton.disabled = reading.size > 0 || (first && state.sources.length === 0);
  lookAgainButton.disabled = reading.size > 0;
}

function showSetup(): void {
  hideTip();
  mainView.hidden = true;
  navBar.hidden = state.firstRun;
  setupView.hidden = false;
  renderSetup();
  renderPage();
}

// Out of Settings, or the first run, and back to the pages. Everything
// ticked has just been read, so it is shown without reading again.
async function leaveSetup(): Promise<void> {
  if (state.firstRun) state = await api.finishFirstRun();
  if (state.firstRun) return;
  showMain();
  renderMain(await api.report());
  // Days are cut in the home zone, so a new zone means reading again.
  if (zoneStale) {
    zoneStale = false;
    await refresh();
  }
}

async function during(source: Source, work: () => Promise<AppState>): Promise<void> {
  const key = keyOf(source);
  setBusy(true);
  reading.add(key);
  renderSetup();
  try {
    state = await work();
  } finally {
    reading.delete(key);
    renderSetup();
    setBusy(false);
  }
}

async function toggle(source: Source, on: boolean): Promise<void> {
  if (on) return during(source, () => api.addSource(source));
  state = await api.removeSource(source);
  renderSetup();
}

function readAgain(source: Source): Promise<void> {
  return during(source, () => api.readSource(source));
}

async function answerKeepYear(yes: boolean): Promise<void> {
  state = await api.answerKeepYear(yes);
  renderSetup();
}

async function start(): Promise<void> {
  state = await api.state();
  useLocale(state.locale);

  refreshButton.addEventListener("click", () => void refresh());
  settingsButton.addEventListener("click", () => showSetup());
  lookAgainButton.addEventListener("click", async () => {
    state = await api.lookAgain();
    renderSetup();
  });
  zoneSelect.addEventListener("change", async () => {
    state = await api.setZone(zoneSelect.value);
    zoneChanged = true;
    zoneStale = !state.firstRun;
    renderSetup();
  });
  planInput.addEventListener("change", async () => {
    state = await api.setPlanPrice(planInput.value);
    renderSetup();
  });
  hideBox.addEventListener("change", async () => {
    state = await api.setHideNames(hideBox.checked);
    renderSetup();
  });
  doneButton.addEventListener("click", () => void leaveSetup());
  el("last-week-close").addEventListener("click", async () => {
    el("last-week").hidden = true;
    state = await api.closeWeekLine();
  });
  el("share-open").addEventListener("click", () => {
    const card = shown?.screens.share;
    if (card) openCard(card, "Your share picture", `vibehours-${shown?.report?.range?.to ?? "stats"}`);
  });
  el<HTMLSelectElement>("month-pick").addEventListener("change", (event) => {
    pickedMonth = (event.target as HTMLSelectElement).value;
  });
  el("month-open").addEventListener("click", () => {
    const month = shown?.screens.months.find((m) => m.month === pickedMonth);
    if (month) openCard(month.card, `Your card for ${month.name}`, `vibehours-${month.month}`);
  });
  el("card-save").addEventListener("click", () => void saveCard());
  el("card-copy").addEventListener("click", () => void copyCard());
  el("card-close").addEventListener("click", () => cardDialog.close());
  for (const p of PAGES) {
    el(`nav-${p.id}`).addEventListener("click", async () => {
      page = p.id;
      if (!setupView.hidden) {
        if (reading.size > 0) return;
        await leaveSetup();
      } else {
        renderPage();
      }
      window.scrollTo(0, 0);
    });
  }
  // The charts are drawn to fit, so a new width means drawing them again.
  window.addEventListener("resize", () => {
    if (!mainView.hidden && pagesBox.clientWidth !== drawnWidth) renderPage();
  });
  window.addEventListener("scroll", hideTip, { passive: true });

  api.onChanged((result) => {
    if (!mainView.hidden) renderMain(result);
    else state = result.state;
  });

  if (state.firstRun) {
    showSetup();
    setBusy(false);
  } else {
    showMain();
    // What the store holds shows at once; the fresh read replaces it.
    renderMain(await api.report());
    await refresh();
  }
}

void start();
