// Makes a made-up home folder for looking at the app: a Claude Code prompt
// history across three made-up projects, a month of transcripts and an SSH
// config. Everything in it is
// invented by this script; nothing is copied from a real machine.
//
//   node scripts/fake-home.js <folder> [days of history] [days of transcripts] [desktop]
//
// With `desktop` the home is one where Claude Code has only ever been used
// from an app that keeps no prompt history: transcripts, and no
// `history.jsonl` or `settings.json`. With -1 days of transcripts it is one
// with a prompt history and no transcripts.

const fs = require("node:fs");
const path = require("node:path");

const [home, historyDays = "120", transcriptDays = "30", kind = ""] = process.argv.slice(2);
const desktop = kind === "desktop";
// What the Claude desktop app's Code sessions mark their lines with.
const entrypoint = desktop ? "claude-desktop" : "cli";
if (!home) {
  console.error("usage: node scripts/fake-home.js <folder> [days of history] [days of transcripts]");
  process.exit(2);
}

// The same numbers every run, so two pictures can be compared.
let seed = 20260302;
const rand = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const MINUTE = 60_000;
const DAY = 86_400_000;
const MODELS = ["claude-example-large", "claude-example-small"];
const TOOLS = ["Bash", "Bash", "Bash", "Read", "Read", "Edit", "Edit", "Write", "Grep", "Glob", "Task", "mcp__example__lookup"];
const PROJECTS = ["/made/up/garden-planner", "/made/up/garden-planner", "/made/up/garden-planner", "/made/up/recipe-box", "/made/up/recipe-box", "/made/up/shed-inventory"];
// Made-up prompts, so the Prompts page has words to count.
const VERBS = ["fix", "add", "rename", "tidy", "test", "explain", "move", "check"];
const THINGS = ["the seed list", "the planting calendar", "the recipe card", "the shopping list", "the shelf labels", "the failing test", "the import step", "the settings page"];
const TAILS = ["", "", " and run the tests", " then commit", " please", " before the next step", " and say what changed"];
const COMMANDS = ["/review", "/review", "/commit", "/plan"];
const pick = (list) => list[between(0, list.length - 1)];
const madeUpPrompt = () => (rand() < 0.08 ? `${pick(COMMANDS)}${rand() < 0.5 ? " the last change" : ""}` : `${pick(VERBS)} ${pick(THINGS)}${pick(TAILS)}`);

const claude = path.join(home, ".claude");
const projects = path.join(claude, "projects");
fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });

const now = Date.now();
const history = [];
let files = 0;
let reply = 0;

for (let back = Number(historyDays); back >= 0; back--) {
  if (rand() < 0.2) continue;
  const dayStart = now - back * DAY - (now % DAY);
  const session = `00000000-0000-4000-8000-${String(back).padStart(12, "0")}`;
  const project = pick(PROJECTS);
  const lines = [];
  let cost = 0;
  let added = 0;
  // Most days start in the morning; a few start late and run past midnight.
  let t = dayStart + (rand() < 0.12 ? between(11, 13) : between(0, 4)) * 60 * MINUTE;
  for (let block = between(1, 3); block > 0 && t < now; block--) {
    for (let prompt = between(2, 14); prompt > 0 && t < now; prompt--) {
      history.push({ display: madeUpPrompt(), pastedContents: {}, timestamp: t, project, sessionId: session });
      // The same prompt as the transcript has it, and a tool's result after it.
      lines.push({
        parentUuid: "made-up", isSidechain: false, promptId: "made-up", type: "user", message: { role: "user", content: "made-up prompt" },
        timestamp: new Date(t).toISOString(), origin: { kind: "human" }, permissionMode: "default", promptSource: "typed",
        userType: "external", entrypoint, cwd: project, sessionId: session,
      });
      lines.push({
        parentUuid: "made-up", isSidechain: false, promptId: "made-up", type: "user",
        message: { role: "user", content: [{ tool_use_id: "made-up", type: "tool_result", content: "made-up output" }] },
        timestamp: new Date(t + 2000).toISOString(), toolUseResult: { stdout: "made-up output" },
        userType: "external", entrypoint, cwd: project, sessionId: session,
      });
      // The agent works for a while after each prompt.
      let at = t;
      for (let turn = between(1, 5); turn > 0; turn--) {
        at += between(5, 240) * 1000;
        if (at >= now) break;
        const id = `msg_made_up_${++reply}`;
        const model = MODELS[rand() < 0.8 ? 0 : 1];
        const usage = [between(2, 40), between(40, 2500), between(20_000, 400_000), between(0, 9000)];
        for (let part = 1; part <= 3; part++) {
          lines.push({
            parentUuid: "made-up", isSidechain: false, type: "assistant", entrypoint, cwd: project, sessionId: session,
            timestamp: new Date(at + part * 400).toISOString(),
            message: {
              id, model, type: "message", role: "assistant",
              content: [part === 3 ? { type: "tool_use", id: `tool_${reply}`, name: TOOLS[between(0, TOOLS.length - 1)], input: {} } : { type: "text", text: "made-up reply" }],
              usage: { input_tokens: usage[0], output_tokens: Math.round((usage[1] * part) / 3), cache_read_input_tokens: usage[2], cache_creation_input_tokens: usage[3] },
            },
          });
        }
        cost += usage[1] * 0.00009 + usage[2] * 0.0000006;
        added += between(0, 30);
      }
      lines.push({ type: "system", subtype: "turn_duration", durationMs: at - t, timestamp: new Date(at + 1500).toISOString(), sessionId: session, entrypoint, cwd: project });
      t += between(2, 22) * MINUTE;
    }
    t += between(45, 200) * MINUTE;
  }
  if (back <= Number(transcriptDays) && lines.length) {
    lines.push({ type: "cost-state", sessionId: session, totalCostUSD: cost, totalLinesAdded: added, totalLinesRemoved: Math.round(added / 7), startTime: dayStart, modelUsage: {}, hasUnknownModelCost: false });
    const folder = path.join(projects, project.replace(/\//g, "-"));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${session}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    files++;
  }
}

if (!desktop) {
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, "history.jsonl"), history.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ theme: "dark" }, null, 2) + "\n");
}
// Hosts that end in .invalid can never resolve, so nothing real is reached.
fs.writeFileSync(path.join(home, ".ssh", "config"), "Host shed.invalid\n    User sam\n\nHost attic.invalid\n    User sam\n");
console.log(`made ${desktop ? "no prompt history" : `${history.length} prompts`} and ${files} transcripts in ${home}`);
