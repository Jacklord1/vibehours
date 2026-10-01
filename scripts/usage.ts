// Prints what the transcripts in a Claude Code folder add up to, how that
// compares with Claude Code's own count, and the figures behind the pages.
// Totals only: no prompt or reply text, no word and no project name is ever
// printed.
//
//   npm run usage -- <claude folder> <zone> [from YYYY-MM-DD] [to YYYY-MM-DD]

import * as fs from "node:fs";
import * as path from "node:path";
import { activeDays, buildReport, dayKeyer, idHash, mergeSources, parseRows, spansOf } from "../src/engine/hours";
import { cardText, firedInsights, monthCards, pickInsights, styleLabel } from "../src/engine/insights";
import { buildScreens } from "../src/engine/screens";
import { TranscriptFile, applyFiles, buildUsage, folderTokens, isWanted, typedRows } from "../src/engine/transcripts";
import { listLocal, pullLocal } from "../src/main/sources";

const [dir, zone, from, to] = process.argv.slice(2);
if (!dir || !zone) {
  console.error("usage: usage <claude folder> <zone> [from] [to]");
  process.exit(2);
}

const n = (v: number | null, digits = 2) => (v === null ? "missing" : v.toFixed(digits));
const count = (v: number) => v.toLocaleString("en-US");

async function main(): Promise<void> {
  const projects = path.join(dir, "projects");
  const listed = await listLocal(projects);
  if (!listed.ok) throw new Error(listed.detail);
  const batch = new Map(listed.files.map((f) => [f.path, new TranscriptFile(f.path, f.size)]));
  const pulled = await pullLocal([...batch.keys()], (p, line) => batch.get(p)?.feed(line), projects);
  if (!pulled.ok) throw new Error(pulled.detail);
  const applied = applyFiles({}, [...batch.values()], zone);

  let history = "";
  try {
    history = fs.readFileSync(path.join(dir, "history.jsonl"), "utf8");
  } catch {
    // No prompt history: session hours from the transcripts alone.
  }
  // As the app does: a session the prompt history does not hold is counted
  // from the typed lines of its transcript.
  const fromHistory = parseRows(history);
  const lacking = typedRows([applied.files], new Set(fromHistory.sessions ?? []));
  const parsed = mergeSources([fromHistory, { rows: lacking, dropped: 0, badLines: 0 }]);
  const now = Date.now();
  const usage = buildUsage([applied.files], {
    zone,
    now,
    from,
    to,
    promptSpans: spansOf(parsed.timestamps),
    promptingHours: new Map(buildReport(parsed, { zone, now }).days.map((d) => [d.day, d.hours])),
  });

  const bytes = listed.files.reduce((sum, f) => sum + f.size, 0);
  const lines = [...batch.values()].reduce((sum, f) => sum + f.lines, 0);
  const bad = [...batch.values()].reduce((sum, f) => sum + f.bad, 0);
  console.log(`files            ${listed.files.length} (${count(bytes)} bytes), ${listed.files.filter((f) => f.path.includes("/subagents/")).length} of them sub-agents'`);
  console.log(`lines read       ${count(lines)}, ${count(bad)} bad; files left out as changed: ${applied.changed.length}`);
  if (!usage) {
    console.log("no transcripts in range");
    return;
  }
  const prompting = buildReport(parsed, { zone, now, from: usage.range.from, to: usage.range.to });
  const all = usage.tokens.reduce((a, b) => a + b, 0);
  console.log(`zone             ${zone}`);
  console.log(`range            ${usage.range.from} to ${usage.range.to} (${usage.totalDays} days)`);
  console.log(`prompting hours  ${n(prompting.headline?.totalHours ?? null)} in the same range`);
  console.log(`session hours    ${n(usage.sessionHours)}   a week ${n(usage.sessionHoursPerWeek)}`);
  console.log(`agent hours      ${n(usage.agentHours)}   a week ${n(usage.agentHoursPerWeek)}`);
  console.log(`turn timer       ${n(usage.turnHours)} hours, by Claude Code's own turn_duration lines`);
  console.log(`most at once     ${usage.mostAtOnce ? `${usage.mostAtOnce.sessions} on ${usage.mostAtOnce.day}` : "none"}`);
  console.log(`unattended       ${usage.unattended.runs} runs, ${n(usage.unattended.hours)} hours`);
  console.log(`replies          ${count(usage.replies)}`);
  console.log(`tokens           ${count(all)}  (in ${count(usage.tokens[0])}, out ${count(usage.tokens[1])}, cache read ${count(usage.tokens[2])}, cache write ${count(usage.tokens[3])})`);
  for (const [model, u] of Object.entries(usage.byModel).sort((a, b) => b[1][1] - a[1][1])) {
    console.log(`  ${model.padEnd(28)} in ${count(u[0])}, out ${count(u[1])}, cache read ${count(u[2])}, cache write ${count(u[3])}`);
  }
  console.log(`biggest day      ${usage.biggestDay ? `${count(usage.biggestDay.tokens)} on ${usage.biggestDay.day}` : "none"}`);
  console.log(`list-price cost  ${n(usage.cost)} USD over ${usage.sessions} sessions, ${usage.sessionsWithoutCost} with no record`);
  console.log(`lines            +${n(usage.linesAdded, 0)} -${n(usage.linesRemoved, 0)}`);
  console.log(`sub-agents       ${usage.subAgents}`);
  const tools = Object.entries(usage.tools).sort((a, b) => b[1] - a[1]);
  console.log(`tool uses        ${count(tools.reduce((s, [, v]) => s + v, 0))}: ${tools.slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  typedClosure(history, applied.files, fromHistory.sessions ?? [], lacking.length, usage.range);
  if (from || to) return;

  // The figures behind the pages, with every name hidden. Never a word list.
  const screens = buildScreens({
    report: buildReport(parsed, { zone, now }),
    usage,
    rows: parsed.rows,
    folderTokens: folderTokens([applied.files], usage.range.from, usage.range.to),
    zone,
    now,
    hideNames: true,
    locale: "en-AU",
  });
  const day = (r: { day: string; hours: number } | null) => (r ? `${n(r.hours)} h on ${r.day}` : "missing");
  const w = screens.week;
  console.log("");
  console.log(
    w
      ? `this week        from ${w.weekStart}: ${w.activeDays} of ${w.daysSoFar} days, ${n(w.hours)} h; ` +
          (w.average ? `average week ${n(w.average.hours)} h over ${w.average.weeks} whole weeks, ${n(w.average.hoursByNow)} h by this weekday` : "no whole week yet")
      : "this week        none",
  );
  console.log(`biggest day      ${day(screens.records.biggestDay)}`);
  console.log(`busiest week     ${screens.records.busiestWeek ? `${n(screens.records.busiestWeek.hours)} h, week of ${screens.records.busiestWeek.weekStart}` : "missing"}`);
  console.log(`longest session  ${day(screens.records.longestSession)}`);
  console.log(`biggest tokens   ${screens.records.biggestTokenDay ? `${count(screens.records.biggestTokenDay.tokens)} on ${screens.records.biggestTokenDay.day}` : "missing"}`);
  console.log(`late nights      ${screens.late?.pastMidnight ?? 0} of ${screens.late?.activeDays ?? 0} days ran past midnight`);
  console.log(`projects         ${screens.projects.length}; top five by hours, names hidden:`);
  for (const p of screens.projects.slice(0, 5)) console.log(`  ${p.name.padEnd(12)} ${n(p.hours)} h, ${count(p.prompts)} prompts`);
  if (screens.words !== null) throw new Error("words were counted with names hidden");
  const one = screens.oneFolder;
  console.log(`one folder       ${one ? `the first row holds ${n(one.hours)} of ${n(one.of)} project hours` : "no one folder holds over 80%"}`);

  // What the app says about the numbers: every rule that fires, with the
  // figures it quotes, then the lines shown. Sentences of totals; no name.
  const said = { report: buildReport(parsed, { zone, now }), usage, rows: parsed.rows, rhythm: screens.rhythm, late: screens.late, zone, now, locale: "en-AU" };
  const fired = firedInsights(said);
  const picked = new Set(pickInsights(fired).map((line) => line.id));
  console.log("");
  console.log(`insight rules    ${fired.length} fire; the ${picked.size} marked * are shown`);
  for (const line of fired) {
    console.log(`  ${picked.has(line.id) ? "*" : " "} ${line.id}: ${line.text}`);
    console.log(`      ${JSON.stringify(line.figures)}`);
  }
  const label = styleLabel(said);
  console.log(`label            ${label ? `${label.name}: ${label.why}` : "none: under four weeks of history"}`);
  const c = screens.comparison;
  console.log(`per active day   ${c && c.perActiveDay !== null ? `${n(c.perActiveDay)} USD over ${c.activeDays} active days, beside ${c.published.average} (${c.published.who}, read ${c.published.readOn})` : "missing"}`);
  console.log(`last week        ${screens.lastWeek ? screens.lastWeek.text : "none"}`);
  console.log("");
  console.log("share picture, every string on it:");
  for (const text of screens.share ? cardText(screens.share) : []) console.log(`  ${text}`);
  const months = monthCards(said);
  console.log(`monthly cards    ${months.length}: ${months.map((m) => m.month).join(", ")}`);
  for (const m of months.slice(0, 2)) {
    console.log(`card for ${m.month}, every string on it:`);
    for (const text of cardText(m.card)) console.log(`  ${text}`);
  }

  await closure(projects, [...batch.values()]);
}

/**
 * Claude Code's own count against this one, session by session: the last
 * `cost-state` record of each run of a session, added up, beside the tokens
 * counted from its replies. Background models are compared too.
 */
async function closure(projects: string, files: TranscriptFile[]): Promise<void> {
  type Four = [number, number, number, number];
  const theirs = new Map<string, Map<number, Four>>();
  const paths = files.filter((f) => f.costs.size > 0).map((f) => f.path);
  await pullLocal(
    paths,
    (_p, line) => {
      if (!isWanted(line)) return;
      const r = JSON.parse(line) as { type?: string; sessionId?: string; startTime?: number; modelUsage?: Record<string, Record<string, number>> };
      if (r.type !== "cost-state" || !r.sessionId || typeof r.startTime !== "number") return;
      const sum: Four = [0, 0, 0, 0];
      for (const m of Object.values(r.modelUsage ?? {})) {
        sum[0] += m.inputTokens ?? 0;
        sum[1] += m.outputTokens ?? 0;
        sum[2] += m.cacheReadInputTokens ?? 0;
        sum[3] += m.cacheCreationInputTokens ?? 0;
      }
      const runs = theirs.get(r.sessionId) ?? new Map<number, Four>();
      runs.set(r.startTime, sum);
      theirs.set(r.sessionId, runs);
    },
    projects,
  );

  const mine = new Map<string, Four>();
  const seen = new Set<string>();
  for (const file of files) {
    if (file.session === null) continue;
    const sum = mine.get(file.session) ?? [0, 0, 0, 0];
    for (const [id, m] of file.messages) {
      if (seen.has(id)) continue;
      seen.add(id);
      for (let i = 0; i < 4; i++) sum[i] += m.usage[i];
    }
    mine.set(file.session, sum);
  }

  let exact = 0;
  let under = 0;
  let over = 0;
  let resumed = 0;
  const outRatios: number[] = [];
  const t: Four = [0, 0, 0, 0];
  const y: Four = [0, 0, 0, 0];
  for (const [session, runs] of theirs) {
    if (runs.size > 1) resumed++;
    const their: Four = [0, 0, 0, 0];
    for (const run of runs.values()) for (let i = 0; i < 4; i++) their[i] += run[i];
    const my = mine.get(session) ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      t[i] += their[i];
      y[i] += my[i];
    }
    const a = their.reduce((p, q) => p + q, 0);
    const b = my.reduce((p, q) => p + q, 0);
    if (their.every((v, i) => v === my[i])) exact++;
    else if (b < a) under++;
    else over++;
    if (their[1] > 0) outRatios.push(my[1] / their[1]);
  }
  outRatios.sort((p, q) => p - q);
  const q = (f: number) => (outRatios.length ? (100 * outRatios[Math.min(outRatios.length - 1, Math.floor(f * outRatios.length))]).toFixed(1) : "n/a");
  const pct = (i: number) => (t[i] ? ((100 * y[i]) / t[i]).toFixed(1) : "n/a");
  console.log("");
  console.log(`closure          ${theirs.size} sessions have a cost-state record (${resumed} were resumed and have more than one run)`);
  console.log(`  agree exactly  ${exact}`);
  console.log(`  this count lower   ${under}`);
  console.log(`  this count higher  ${over}`);
  console.log(`  this count as a share of Claude Code's: in ${pct(0)}%, out ${pct(1)}%, cache read ${pct(2)}%, cache write ${pct(3)}%`);
  console.log(`  output tokens, session by session: lowest ${q(0)}%, a tenth below ${q(0.1)}%, median ${q(0.5)}%, highest ${q(1)}%`);
}

/**
 * The typed-prompt closure. For the sessions the prompt history DOES hold,
 * the times a person typed are built from the transcripts by the rule and
 * set beside the history's own rows. If the rule is right the two agree.
 * Counts, gaps and hours only.
 */
function typedClosure(
  history: string,
  files: ReturnType<typeof applyFiles>["files"],
  heldSessions: string[],
  lackingPrompts: number,
  range: { from: string; to: string },
): void {
  const keyOf = dayKeyer(zone);
  const inRange = (t: number) => keyOf(t) >= range.from && keyOf(t) <= range.to;
  const held = new Set(heldSessions);
  // Each transcript session, by the same short hash the history's sessions are kept as.
  const bySession = new Map<string, number[]>();
  for (const [p, file] of Object.entries(files)) {
    if (file.sub) continue;
    const key = idHash(file.session ?? p);
    const times = bySession.get(key) ?? [];
    for (const t of file.typed ?? []) if (!times.includes(t)) times.push(t);
    bySession.set(key, times);
  }
  // The history's own rows, by session, housekeeping rows left out as the app leaves them out.
  const kept = new Set(parseRows(history).rows.map((r) => r.t));
  const rowsBySession = new Map<string, number[]>();
  for (const line of history.split("\n")) {
    let r: { timestamp?: unknown; sessionId?: unknown };
    try {
      r = JSON.parse(line) as typeof r;
    } catch {
      continue;
    }
    if (typeof r.timestamp !== "number" || typeof r.sessionId !== "string" || !kept.has(r.timestamp) || !inRange(r.timestamp)) continue;
    const key = idHash(r.sessionId);
    if (!bySession.has(key)) continue;
    rowsBySession.set(key, [...(rowsBySession.get(key) ?? []), r.timestamp]);
  }

  let rows = 0;
  let typed = 0;
  let paired = 0;
  const gaps: number[] = [];
  const ruleTimes: number[] = [];
  for (const [key, all] of bySession) {
    const times = all.filter(inRange);
    ruleTimes.push(...times);
    if (!held.has(key)) continue;
    const theirs = (rowsBySession.get(key) ?? []).sort((a, b) => a - b);
    rows += theirs.length;
    typed += times.length;
    const used = new Set<number>();
    for (const t of theirs) {
      let best = -1;
      let gap = Infinity;
      times.forEach((u, i) => {
        if (!used.has(i) && Math.abs(u - t) < gap) {
          gap = Math.abs(u - t);
          best = i;
        }
      });
      if (best >= 0 && gap <= 120_000) {
        used.add(best);
        paired++;
        gaps.push(gap);
      }
    }
  }
  gaps.sort((a, b) => a - b);
  const gapAt = (f: number) => (gaps.length ? `${(gaps[Math.floor((gaps.length - 1) * f)] / 1000).toFixed(1)} s` : "n/a");
  const hoursOf = (times: number[]) => {
    const days = activeDays([...times].sort((a, b) => a - b), zone).filter((d) => d.day >= range.from && d.day <= range.to);
    return `${n(days.reduce((sum, d) => sum + d.hours, 0))} h on ${days.filter((d) => d.blocks > 0).length} days`;
  };
  const historyTimes = parseRows(history).rows.map((r) => r.t);
  console.log("");
  console.log(`typed prompts    ${range.from} to ${range.to}, sessions the prompt history and the transcripts both hold`);
  console.log(`  history rows                 ${count(rows)}`);
  console.log(`  typed lines by the rule      ${count(typed)}`);
  console.log(`  paired within 2 minutes      ${count(paired)}  (gap: median ${gapAt(0.5)}, nine in ten under ${gapAt(0.9)}, largest ${gapAt(1)})`);
  console.log(`  in the history only          ${count(rows - paired)}`);
  console.log(`  in the transcripts only      ${count(typed - paired)}`);
  console.log(`  prompting hours, history     ${hoursOf(historyTimes)}`);
  console.log(`  prompting hours, rule alone  ${hoursOf(ruleTimes)}`);
  console.log(`  typed in sessions the history does not hold, and so counted from transcripts: ${count(lackingPrompts)}`);
}

void main();
