// Made-up transcript lines, shaped like Claude Code's, for the tests.

import type { Usage } from "../src/engine/transcripts";

interface ReplyLine {
  at: string;
  id: string;
  usage?: Usage;
  model?: string;
  session?: string;
  tools?: string[];
  entrypoint?: string;
}

/** One `assistant` line, shaped like Claude Code's, with made-up words in it. */
export function reply(o: ReplyLine): string {
  const [input, output, cacheRead, cacheWrite] = o.usage ?? [10, 100, 1000, 50];
  return JSON.stringify({
    parentUuid: "made-up",
    isSidechain: false,
    message: {
      model: o.model ?? "claude-made-up-1",
      id: o.id,
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "made-up reply words that must never be kept" },
        ...(o.tools ?? []).map((name, i) => ({ type: "tool_use", id: `${o.id}-${o.at}-${i}`, name, input: {} })),
      ],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
      },
    },
    type: "assistant",
    timestamp: o.at,
    entrypoint: o.entrypoint ?? "cli",
    cwd: "/made/up/project",
    sessionId: o.session ?? "session-a",
  });
}

export function costState(session: string, start: number, usd: number, added = 0, removed = 0): string {
  return JSON.stringify({
    type: "cost-state",
    sessionId: session,
    totalCostUSD: usd,
    totalLinesAdded: added,
    totalLinesRemoved: removed,
    startTime: start,
    modelUsage: {},
    hasUnknownModelCost: false,
  });
}

interface TypedLine {
  at: string;
  session?: string;
  entrypoint?: string;
  /** What Claude Code says the line came from. Absent: no `origin` at all. */
  origin?: string | null;
  meta?: boolean;
  sidechain?: boolean;
  /** How the prompt reached Claude Code. The desktop app's say `sdk`. */
  source?: string;
  /** The prompt is a picture with words, as content parts. */
  picture?: boolean;
}

const TYPED_WORDS = "made-up prompt words that must never be kept";

/** One `user` line holding a prompt, shaped like Claude Code's. A person typed it unless told otherwise. */
export function typed(o: TypedLine): string {
  const origin = o.origin === undefined ? "human" : o.origin;
  return JSON.stringify({
    parentUuid: "made-up",
    isSidechain: o.sidechain === true,
    promptId: "made-up",
    type: "user",
    message: { role: "user", content: o.picture ? [{ type: "image", source: { type: "base64", data: "bWFkZS11cA==" } }, { type: "text", text: TYPED_WORDS }] : TYPED_WORDS },
    ...(o.meta ? { isMeta: true } : {}),
    uuid: `u-${o.at}`,
    timestamp: o.at,
    ...(origin === null ? {} : { origin: { kind: origin }, permissionMode: "default", promptSource: o.source ?? (origin === "human" ? "typed" : "system") }),
    userType: "external",
    entrypoint: o.entrypoint ?? "cli",
    cwd: "/made/up/project",
    sessionId: o.session ?? "session-a",
  });
}

/** A `user` line that is a tool's result, which is most of them. Its words quote the marker of a typed line. */
export function toolResult(at: string, session = "session-a"): string {
  return JSON.stringify({
    parentUuid: "made-up",
    isSidechain: false,
    promptId: "made-up",
    type: "user",
    message: { role: "user", content: [{ tool_use_id: "made-up", type: "tool_result", content: 'made-up output quoting "origin":{"kind":"human"} from a file' }] },
    uuid: `r-${at}`,
    timestamp: at,
    toolUseResult: { stdout: "made-up output that must never be kept" },
    sourceToolAssistantUUID: "made-up",
    userType: "external",
    entrypoint: "cli",
    cwd: "/made/up/project",
    sessionId: session,
  });
}

/** A prompt typed while the agent was busy: an `attachment` line, written when it was taken up. */
export function queued(typedAt: string, takenAt: string, session = "session-a", mode = "prompt"): string {
  return JSON.stringify({
    parentUuid: "made-up",
    isSidechain: false,
    type: "attachment",
    attachment: {
      type: "queued_command",
      prompt: TYPED_WORDS,
      commandMode: mode,
      origin: { kind: mode === "prompt" ? "human" : "task-notification" },
      timestamp: typedAt,
    },
    uuid: `q-${typedAt}`,
    timestamp: takenAt,
    userType: "external",
    entrypoint: "cli",
    cwd: "/made/up/project",
    sessionId: session,
  });
}
