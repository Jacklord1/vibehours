// What the app says about a source: which of the states it is in, and the
// sentence for each. Kept apart from the page and given its formats from
// outside, so every sentence can be tested against the state that picks it.
//
// A source has two things to read, the prompt history and the transcripts,
// and either can be missing. Claude Code in a terminal writes both. The
// Claude desktop app's Code sessions write transcripts and no prompt
// history, so a missing history is not a failure and not "nothing found".

type WordsStatus = import("../main/session").SourceStatus;

/**
 * - `both`: a prompt history and transcripts.
 * - `transcripts-only`: transcripts and no prompt history.
 * - `history-only`: a prompt history and no transcripts.
 * - `nothing`: neither, and nothing kept from before.
 * - `failing`: something that was there, or should be, could not be read.
 * - `unread`: not read since the app opened.
 */
type SourceCase = "unread" | "both" | "transcripts-only" | "history-only" | "nothing" | "failing";

interface WordsFormats {
  /** A day and a time, for something read earlier. */
  when(ms: number): string;
  time(ms: number): string;
  day(ms: number): string;
  count(n: number): string;
  hideNames: boolean;
  windows: boolean;
}

const FORMAT_CHANGED = "Claude Code may have changed how it keeps its history. These numbers may be incomplete.";

function sourceCase(s: WordsStatus): SourceCase {
  if (s.state === "unread") return "unread";
  const t = s.transcripts;
  const files = t.state === "ok" ? t.files : 0;
  if (s.state === "ok") return t.state === "failed" ? "failing" : files > 0 ? "both" : "history-only";
  if (s.reason === "not-found" && t.state !== "failed") {
    if (files > 0) return "transcripts-only";
    if (s.storedAt === null && s.transcriptsStoredAt === null) return "nothing";
  }
  return "failing";
}

/** A source whose numbers are in what is shown: read now, or kept from before. */
function isCounted(s: WordsStatus): boolean {
  const c = sourceCase(s);
  return c === "both" || c === "transcripts-only" || c === "history-only" || s.storedAt !== null || s.transcriptsStoredAt !== null;
}

function wordsPlural(f: WordsFormats, n: number, word: string): string {
  return `${f.count(n)} ${word}${n === 1 ? "" : "s"}`;
}

/** Ends what a program or the system said as a sentence, so the next one does not run on from it. */
function stopped(text: string): string {
  return /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

// What ssh said can name a machine, so it is not written out while names are hidden.
function sshSaid(detail: string, f: WordsFormats): string {
  if (f.hideNames) return "What ssh said is not shown while names are hidden.";
  return stopped(`ssh said: ${detail.replace(/^ssh: /, "")}`);
}

/** Looked, and neither a prompt history nor a transcript is there now. */
function foundNothing(s: WordsStatus): boolean {
  return s.state === "failed" && s.reason === "not-found" && s.transcripts.state !== "failed";
}

/**
 * The quiet line for a source whose numbers are shown from an earlier read.
 * A source that answered and has nothing in it now was read: it is not said
 * to be unreadable.
 */
function staleText(s: WordsStatus, name: string, f: WordsFormats): string {
  const at = s.storedAt ?? s.transcriptsStoredAt;
  const from = at === null ? "" : `, so its numbers are the ones read at ${f.when(at)}`;
  if (foundNothing(s)) return `Nothing from Claude Code was found on ${name} this time${from}.${f.hideNames || s.state !== "failed" ? "" : ` Looked for ${s.detail} and for transcripts beside it.`}`;
  const why = s.state === "failed" && s.reason === "failed" ? sshSaid(s.detail, f) : failureText(s, f);
  return `${name} could not be read just now${from}. ${why}`;
}

/** The amber box when there is nothing at all to show, and its detail lines. `named` gives a source its name. */
function noNumbersText(sources: WordsStatus[], named: (s: WordsStatus) => string, f: WordsFormats): { line: string; detail: string[] } {
  const failing = sources.filter((s) => sourceCase(s) === "failing");
  if (failing.length === 0) {
    return {
      line: "No Claude Code prompt history or transcripts were found, so there is nothing to count yet.",
      detail: ["If you use Claude Code there, in a terminal or in the Claude desktop app, type a prompt in it, then press Refresh."],
    };
  }
  const detail = sources.map((s) => `${named(s)}: ${sourceCase(s) === "failing" ? failureText(s, f) : "nothing from Claude Code was found there."}`);
  return { line: failing.length === sources.length ? "None of your sources could be read, so there are no numbers to show." : "There are no numbers to show.", detail };
}

/** Why the prompt history could not be read. For a source whose history failed. */
function failureText(s: WordsStatus, f: WordsFormats): string {
  if (s.state !== "failed") return "";
  if (s.reason === "not-found") {
    if (s.transcripts.state === "failed") return `Its transcripts could not be read${f.hideNames ? "." : stopped(`: ${s.transcripts.detail}`)}`;
    // Nothing there now. Whether anything was kept from before is said by the caller.
    return `No Claude Code prompt history or transcripts were found.${f.hideNames ? "" : ` Looked for ${s.detail} and for transcripts beside it.`}`;
  }
  if (s.reason === "unreadable") return `The history file is there but could not be read${f.hideNames ? "." : stopped(`: ${s.detail}`)}`;
  if (s.reason === "changed") return `${s.detail} lines of its prompt history could not be read.`;
  if (s.reason === "program-missing") {
    return f.windows
      ? "This PC has no ssh program. On Windows it is the optional feature called OpenSSH Client."
      : "This PC has no ssh program. It is in the package called openssh-client.";
  }
  return `Could not be read. ${sshSaid(s.detail, f)}`;
}

/** The line under a ticked source in Settings, and whether it is a warning. */
function statusText(s: WordsStatus, f: WordsFormats): { text: string; bad: boolean } {
  const c = sourceCase(s);
  if (s.state === "unread") {
    const kept = s.storedAt ?? s.transcriptsStoredAt;
    return { text: kept === null ? "Not read yet." : `Last read at ${f.when(kept)}.`, bad: false };
  }
  const t = s.transcripts;
  const unreadable = t.state === "ok" && t.changed ? `, ${f.count(t.changed)} of them unreadable` : "";
  if (c === "nothing") return { text: failureText(s, f), bad: false };
  if (c === "transcripts-only" && t.state === "ok") {
    return {
      text:
        `${wordsPlural(f, t.files, "transcript")}${unreadable}, and no terminal prompt history. ` +
        `The times you typed are taken from the transcripts. Read at ${f.time(t.readAt)}.`,
      bad: false,
    };
  }
  if (s.state === "failed") {
    const at = s.storedAt ?? s.transcriptsStoredAt;
    const kept = at === null ? "" : ` Its numbers are the ones read at ${f.when(at)}.`;
    return { text: (s.reason === "changed" ? `${FORMAT_CHANGED} ` : "") + failureText(s, f) + kept, bad: true };
  }
  const prompts =
    s.prompts === 0 || s.firstPrompt === null ? "No prompts in its history yet." : `${wordsPlural(f, s.prompts, "prompt")}, the first on ${f.day(s.firstPrompt)}.`;
  if (c === "history-only") {
    return { text: `${prompts} No transcripts, so no tokens or session hours come from here. Read at ${f.time(s.readAt)}.`, bad: false };
  }
  const transcripts =
    t.state === "ok"
      ? ` ${wordsPlural(f, t.files, "transcript")}${unreadable}.`
      : t.state === "failed"
        ? ` Its transcripts could not be read${f.hideNames ? "." : stopped(`: ${t.detail}`)}`
        : "";
  return { text: `${prompts}${transcripts} Read at ${f.time(s.readAt)}.`, bad: t.state === "failed" };
}
