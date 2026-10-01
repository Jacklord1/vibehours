// The pages after the Overview: Time, Tokens, Agent, Prompts and Projects.
// Each is built from what the shell sent and drawn at the width it is given.
// Helpers for dates and numbers are in renderer.ts.

type Screens = import("../engine/screens").Screens;
type UsageDay = import("../engine/transcripts").UsageDay;

function fmtDayShort(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(Date.UTC(y, m - 1, d));
}

function fmtDayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    Date.UTC(y, m - 1, d),
  );
}

function fmtMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short" }).format(Date.UTC(y, m - 1, 1));
}

// 1 March 2026 is a Sunday.
function weekdayName(i: number, width: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: width }).format(Date.UTC(2026, 2, 1 + i));
}

function fmtHour(hour: number): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "numeric" }).format(Date.UTC(2026, 2, 1, hour));
}

function fromTo(range: { from: string; to: string }): string {
  return `${fmtDay(range.from)} to ${fmtDay(range.to)}`;
}

function heading(text: string): HTMLElement {
  return node("h2", "", text);
}

function tiles(columns: "two" | "three" | "four", ...items: HTMLElement[]): HTMLElement {
  const list = node("dl", `tiles ${columns}`);
  list.append(...items);
  return list;
}

/** A card that says why there is nothing to draw. */
function emptyCard(title: string, why: string): HTMLElement {
  const card = node("section", "card chart-card");
  card.append(node("h3", "", title), node("p", "empty", why));
  return card;
}

/** Cards side by side when there is room, one under the other when not. */
function pair(width: number, build: (inner: number) => HTMLElement[]): HTMLElement {
  const two = width >= 760;
  const box = node("div", two ? "pair two" : "pair");
  box.append(...build(cardInner(two ? (width - 12) / 2 : width)));
  return box;
}

// A card's padding and border, taken off the width a chart inside it has.
function cardInner(width: number): number {
  return Math.floor(width - 34);
}

function noTranscripts(result: LoadResult, what: string): HTMLElement {
  const reading = result.state.sources.some((s) => s.reading !== null);
  return emptyCard(
    reading ? "Reading your transcripts…" : "No transcripts to count",
    `${what} come from the session transcripts Claude Code keeps, and ${reading ? "they are still being read" : "none has been read"}.` +
      (reading ? " The first time can take a minute." : " Claude Code deletes them after 30 days unless told otherwise."),
  );
}

// --------------------------------------------------------------------- time

function renderTime(result: LoadResult, width: number): HTMLElement[] {
  const { screens, report } = result;
  const out: HTMLElement[] = [];
  const inner = cardInner(width);

  const year = screens.year;
  if (!year || !report?.range) {
    out.push(emptyCard("The year in squares", "There is no prompt history to draw yet."));
    return out;
  }
  const cells = year.squares.map((s) => ({
    day: s.day,
    title: fmtDayLong(s.day),
    shown: s.hours === null ? null : `${fmtNumber(s.hours)} h`,
    level: s.level,
  }));
  const keys = [
    { cls: "l0", name: "No hours" },
    { cls: "l1", name: "Under 2 h" },
    { cls: "l2", name: "2 to 4 h" },
    { cls: "l3", name: "4 to 6 h" },
    { cls: "l4", name: "6 h or more" },
  ];
  if (year.historyFrom) keys.push({ cls: "out", name: "Before your history" });
  out.push(
    chartCard(
      "The year in squares",
      [
        squaresChart(
          cells,
          inner,
          `Prompting hours for each day from ${fmtDay(year.from)} to ${fmtDay(year.to)}`,
          [0, 1, 2, 3, 4, 5, 6].map((i) => weekdayName(i)),
          fmtMonth,
        ),
        legend(keys),
      ],
      // In dark the scale runs the other way, so the strongest square is still the one that stands out.
      `One square a day from ${fmtDay(year.from)} to ${fmtDay(year.to)}, ${matchMedia("(prefers-color-scheme: dark)").matches ? "lighter" : "darker"} for more prompting hours: ` +
        `${plural(year.activeDays, "day")} used and ${fmtNumber(year.hours, 0)} hours.` +
        (year.historyFrom ? ` Your history starts on ${fmtDay(year.historyFrom)}; the days before it are outlined, not empty.` : ""),
      tableView(
        ["Day", "Prompting hours"],
        year.squares.filter((s) => s.hours !== null).map((s) => [fmtDayLong(s.day), fmtNumber(s.hours as number)]),
      ),
    ),
  );

  const beat = screens.rhythm;
  if (beat) {
    const range = fromTo(report.range);
    out.push(heading("Rhythm"));
    out.push(
      pair(width, (w) => [
        chartCard(
          "Days used, by weekday",
          [
            columnChart({
              width: w,
              label: "Days used, by day of the week",
              series: [{ name: "days used", cls: "s1" }],
              format: fmtCount,
              whole: true,
              items: beat.weekdays.map((d, i) => ({ title: `${weekdayName(i, "long")}s: ${fmtCount(d.of)} in your history`, values: [d.active], tick: weekdayName(i) })),
            }),
          ],
          `How many of each weekday you used Claude Code on, ${range}. A day ends at 4am.`,
          tableView(
            ["Weekday", "Days used", "Of", "Prompting hours"],
            beat.weekdays.map((d, i) => [weekdayName(i, "long"), fmtCount(d.active), fmtCount(d.of), fmtNumber(d.hours)]),
          ),
        ),
        beat.busiestHour
          ? chartCard(
              "Prompts, by hour of the day",
              [
                columnChart({
                  width: w,
                  label: "Prompts typed in each hour of the day",
                  series: [{ name: "prompts", cls: "s1" }],
                  format: fmtCount,
                  whole: true,
                  items: beat.hours.map((n, hour) => ({
                    title: `${fmtHour(hour)} to ${fmtHour((hour + 1) % 24)}`,
                    values: [n],
                    tick: hour % 6 === 0 ? fmtHour(hour) : undefined,
                  })),
                }),
              ],
              `Prompts typed in each hour of the clock, midnight on the left, in your home zone (${state.homeZone}), ${range}. ` +
                `Your busiest hour starts at ${fmtHour(beat.busiestHour.hour)}.`,
              tableView(["Hour", "Prompts"], beat.hours.map((n, hour) => [fmtHour(hour), fmtCount(n)])),
            )
          : emptyCard("Prompts, by hour of the day", "The times of your prompts have not been read yet."),
      ]),
    );
  }

  const late = screens.late;
  if (late && late.latest) {
    out.push(heading("Late nights"));
    out.push(
      tiles(
        "two",
        tile(
          "Latest finish",
          fmtTime(late.latest.at),
          "",
          late.latest.pastMidnight ? `The night of ${fmtDay(late.latest.day)}, into the next morning` : fmtDay(late.latest.day),
        ),
        tile("Days past midnight", fmtCount(late.pastMidnight), "", `Of ${plural(late.activeDays, "day")} used`),
      ),
    );
    out.push(
      node(
        "p",
        "note",
        `From the time of your last prompt each day, ${fromTo(report.range)}. A day ends at 4am, so a late night stays with the day it began.`,
      ),
    );
  }
  return out;
}

// ------------------------------------------------------- columns over the days

// Past about a hundred days the columns would be hairs, so they become weeks.
const DAYS_BEFORE_WEEKS = 100;

function sundayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

interface DayColumns {
  items: { title: string; values: number[]; tick?: string; first: string }[];
  byWeek: boolean;
}

/** One column a day, or a week, with a date under about every 80 pixels. */
function overDays(days: UsageDay[], width: number, valuesOf: (d: UsageDay) => number[], most = false): DayColumns {
  const byWeek = days.length > DAYS_BEFORE_WEEKS;
  const items: DayColumns["items"] = [];
  for (const d of days) {
    const values = valuesOf(d);
    const key = byWeek ? sundayOf(d.day) : d.day;
    const open = items[items.length - 1];
    if (open && open.first === key) {
      open.values = open.values.map((v, i) => (most ? Math.max(v, values[i]) : v + values[i]));
    } else {
      items.push({ first: key, title: byWeek ? `Week of ${fmtDay(key)}` : fmtDayLong(d.day), values });
    }
  }
  const every = Math.max(1, Math.ceil(items.length / Math.max(2, Math.floor(width / 80))));
  items.forEach((item, i) => {
    if (i % every === 0) item.tick = fmtDayShort(item.first);
  });
  return { items, byWeek };
}

// ------------------------------------------------------------------- tokens

const TOKEN_NOTE =
  "Tokens are counted from the transcripts. Claude Code's own count runs a few percent higher, because it makes calls it does not write down.";

function renderTokens(result: LoadResult, width: number): HTMLElement[] {
  const u = result.usage;
  if (!u) return [noTranscripts(result, "Tokens and cost")];
  const out: HTMLElement[] = [];
  const range = fromTo(u.range);
  const all = (t: ArrayLike<number>) => t[0] + t[1] + t[2] + t[3];

  out.push(heading(`Since ${fmtDay(u.range.from)}, from transcripts`));
  out.push(
    tiles(
      "four",
      tile("Tokens in all", fmtBig(all(u.tokens)), "", "Including cache reads"),
      tile("Output tokens", fmtBig(u.tokens[1]), "", "What the model wrote"),
      tile("Biggest token day", u.biggestDay ? fmtBig(u.biggestDay.tokens) : null, "", u.biggestDay ? fmtDay(u.biggestDay.day) : "", "No tokens yet"),
      tile("Replies", fmtCount(u.replies), "", `Across ${plural(u.sessions, "session")}`),
    ),
  );
  out.push(node("p", "note", TOKEN_NOTE));

  out.push(heading("By day"));
  out.push(
    pair(width, (w) => {
      const output = overDays(u.days, w, (d) => [d.tokens ? d.tokens[1] : 0]);
      const total = overDays(u.days, w, (d) => [d.tokens ? all(d.tokens) : 0]);
      const each = output.byWeek ? "week" : "day";
      const table = tableView(
        [output.byWeek ? "Week of" : "Day", "Output tokens", "All tokens"],
        output.items.map((item, i) => [item.title, fmtCount(item.values[0]), fmtCount(total.items[i].values[0])]),
      );
      return [
        chartCard(
          `Output tokens, by ${each}`,
          [columnChart({ width: w, label: `Output tokens by ${each}`, series: [{ name: "output tokens", cls: "s1" }], format: fmtBig, items: output.items })],
          `What the model wrote each ${each}, ${range}.`,
          table,
        ),
        chartCard(
          `All tokens, by ${each}`,
          [columnChart({ width: w, label: `All tokens by ${each}, including cache reads`, series: [{ name: "tokens, including cache reads", cls: "s1" }], format: fmtBig, items: total.items })],
          `Every token each ${each}, including cache reads, which are most of it, ${range}.`,
        ),
      ];
    }),
  );

  const models = Object.entries(u.byModel).sort((a, b) => b[1][1] - a[1][1]);
  out.push(heading("By model"));
  if (models.length === 0) {
    out.push(emptyCard("By model", "No reply with a token count has been read yet."));
  } else {
    out.push(
      pair(width, (w) => [
        chartCard(
          "Output tokens, by model",
          [barList(models.map(([name, t]) => ({ name, value: t[1], shown: fmtBig(t[1]) })), w, "Output tokens by model", "output tokens")],
          `What each model wrote, ${range}.`,
          tableView(["Model", "Output tokens", "All tokens"], models.map(([name, t]) => [name, fmtCount(t[1]), fmtCount(all(t))])),
        ),
        chartCard(
          "All tokens, by model",
          [barList(models.map(([name, t]) => ({ name, value: all(t), shown: fmtBig(all(t)) })), w, "All tokens by model, including cache reads", "tokens, including cache reads")],
          `Every token each model handled, including cache reads, ${range}.`,
        ),
      ]),
    );
  }

  out.push(heading("Value against your plan"));
  const plan = result.screens.plan;
  const typed = state.planPrice;
  const money = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 0 });
  out.push(
    tiles(
      "two",
      tile(
        "List-price value",
        u.cost === null ? null : fmtDollars(u.cost),
        "",
        u.cost === null ? "Claude Code kept no cost for these sessions" : "Claude Code's own figure, in US dollars",
        "No cost kept",
      ),
      plan
        ? tile(
            `Your plan over the same ${plural(plan.days, "day")}`,
            `${plan.price.before}${money(plan.cost)}${plan.price.after ? ` ${plan.price.after}` : ""}`,
            "",
            `At ${typed?.text ?? ""} a month, as you typed it`,
          )
        : tile(
            "Your plan over the same days",
            null,
            "",
            typed && !typed.usable ? `Settings has "${typed.text}", which is not a price Vibehours can read` : "Type what your plan costs a month in Settings",
            "No plan price set",
          ),
    ),
  );
  const costNotes = [
    `List price is what these tokens would have cost paid for one by one, as Claude Code itself added it up, ${range}. It is in US dollars.`,
  ];
  if (plan) costNotes.push("Your plan price is shown in whatever you typed it in. Nothing is converted, so compare the two only if your plan is in US dollars too.");
  if (u.cost !== null && u.sessionsWithoutCost) {
    costNotes.push(`${fmtCount(u.sessionsWithoutCost)} of ${plural(u.sessions, "session")} kept no cost and are left out.`);
  }
  if (u.costHasUnknownModel) costNotes.push("Claude Code had no price for one of the models, so the value is low.");
  out.push(node("p", "note", costNotes.join(" ")));

  // The one comparison: Anthropic's published cost per active day, beside yours.
  const beside = result.screens.comparison;
  if (beside) {
    const PUBLISHED = beside.published;
    out.push(heading("Beside Anthropic's published figure"));
    out.push(
      tiles(
        "two",
        tile(
          "Your list-price value, per active day",
          beside.perActiveDay === null ? null : fmtDollars(beside.perActiveDay),
          "",
          beside.perActiveDay === null
            ? beside.cost === null
              ? "Claude Code kept no cost for these sessions"
              : "No day with a reply yet"
            : `${fmtDollars(beside.cost as number)} over ${plural(beside.activeDays, "active day")}, ${fromTo(beside)}`,
          "No cost kept",
        ),
        tile(
          `${PUBLISHED.who}'s average, per developer per active day`,
          fmtDollars(PUBLISHED.average),
          "",
          `Under ${fmtDollars(PUBLISHED.ninetyPercentUnder)} an active day for 90% of users`,
        ),
      ),
    );
    const source = node("p", "note");
    const link = node("button", "link", "Open the source in your browser");
    link.type = "button";
    link.id = "cost-source";
    link.title = PUBLISHED.url;
    link.addEventListener("click", () => void api.openCostSource());
    source.append(
      `The figure on the right is ${PUBLISHED.who}'s, from its ${PUBLISHED.where}, as read on ${fmtDay(PUBLISHED.readOn)}: \u201c${PUBLISHED.quote}\u201d ` +
        "It is from company deployments, which pay for each token. Yours is what your tokens would have cost at list price, " +
        "whatever plan you are on, over the days Claude Code replied to you. Both are US dollars. The figure is fixed in this build; " +
        "Vibehours does not fetch it. ",
      link,
      ".",
    );
    out.push(source);
    if (beside.perActiveDay !== null && u.sessionsWithoutCost) {
      out.push(node("p", "note", `${fmtCount(u.sessionsWithoutCost)} of ${plural(u.sessions, "session")} kept no cost and are left out, so your figure is low.`));
    }
  }

  out.push(heading("Lines added and removed"));
  const noLines = "Claude Code kept none";
  out.push(
    tiles(
      "two",
      tile("Lines added", u.linesAdded === null ? null : fmtCount(Math.round(u.linesAdded)), "", "By the agent, in your files", noLines),
      tile("Lines removed", u.linesRemoved === null ? null : fmtCount(Math.round(u.linesRemoved)), "", "By the agent, in your files", noLines),
    ),
  );
  out.push(
    node(
      "p",
      "note",
      `From the same records as the cost, ${range}.` +
        (u.sessionsWithoutCost ? ` ${fmtCount(u.sessionsWithoutCost)} of ${plural(u.sessions, "session")} kept no record and are left out.` : ""),
    ),
  );
  return out;
}

// -------------------------------------------------------------------- agent

// The tools Claude Code reaches other services with are counted as one.
function toolName(name: string): string {
  return name === "mcp" ? "MCP tools, all of them" : name;
}

const TOOLS_SHOWN = 12;

function renderAgent(result: LoadResult, width: number): HTMLElement[] {
  const u = result.usage;
  if (!u) return [noTranscripts(result, "Agent hours and tool uses")];
  const out: HTMLElement[] = [];
  const range = fromTo(u.range);
  const inner = cardInner(width);
  const yours = u.sessionHours - u.agentHours;

  out.push(heading(`Since ${fmtDay(u.range.from)}, from transcripts`));
  out.push(
    tiles(
      "four",
      tile("Agent hours", fmtNumber(u.agentHours), "h", `Beside ${fmtNumber(yours)} h of your own prompting`),
      tile("Most sessions at once", u.mostAtOnce ? fmtCount(u.mostAtOnce.sessions) : null, "", u.mostAtOnce ? fmtDay(u.mostAtOnce.day) : "", "No session yet"),
      tile("Sub-agents started", fmtCount(u.subAgents), "", "Agents your agent set to work"),
      tile(
        "Unattended runs",
        fmtCount(u.unattended.runs),
        "",
        u.unattended.runs ? `${fmtNumber(u.unattended.hours)} h, left out of the hours` : "Runs started with no one typing",
      ),
    ),
  );

  const hours = overDays(u.days, inner, (d) => [d.sessionHours - d.agentHours, d.agentHours]);
  const each = hours.byWeek ? "week" : "day";
  out.push(
    chartCard(
      `Your hours and the agent's, by ${each}`,
      [
        legend([
          { cls: "s1", name: "You, prompting" },
          { cls: "s2", name: "The agent, working on" },
        ]),
        columnChart({
          width: inner,
          height: 200,
          label: `Your prompting hours and the agent's hours by ${each}`,
          series: [
            { name: "you, prompting", cls: "s1" },
            { name: "the agent, working on", cls: "s2" },
          ],
          format: (n) => `${fmtNumber(n)} h`,
          tick: (n) => `${fmtNumber(n, Number.isInteger(n) ? 0 : 1)} h`,
          items: hours.items,
        }),
      ],
      `Each column is the time a session was live that ${each}: the part you were prompting, and the part the agent kept working with no prompt from you, ${range}.`,
      tableView(
        [hours.byWeek ? "Week of" : "Day", "You", "The agent", "Session hours"],
        hours.items.map((item) => [item.title, fmtNumber(item.values[0]), fmtNumber(item.values[1]), fmtNumber(item.values[0] + item.values[1])]),
      ),
    ),
  );

  const atOnce = overDays(u.days, inner, (d) => [d.atOnce], true);
  out.push(
    u.mostAtOnce
      ? chartCard(
          `Most sessions at once, by ${each}`,
          [
            columnChart({
              width: inner,
              height: 150,
              label: `The most sessions live at once, by ${each}`,
              series: [{ name: "sessions at once", cls: "s1" }],
              format: fmtCount,
              whole: true,
              items: atOnce.items,
            }),
          ],
          `The most sessions that were live at the same moment each ${each}, ${range}. Two at once count once for hours; this is where they show.`,
          tableView([atOnce.byWeek ? "Week of" : "Day", "Sessions at once"], atOnce.items.map((item) => [item.title, fmtCount(item.values[0])])),
        )
      : emptyCard("Most sessions at once", "No session has been read yet."),
  );

  const tools = Object.entries(u.tools).sort((a, b) => b[1] - a[1]);
  const uses = tools.reduce((sum, [, n]) => sum + n, 0);
  out.push(heading("What it did"));
  if (tools.length === 0) {
    out.push(emptyCard("Tool uses", "The agent used no tool in these transcripts."));
  } else {
    const shown = tools.slice(0, TOOLS_SHOWN);
    const rest = tools.slice(TOOLS_SHOWN);
    const rows = shown.map(([name, n]) => ({ name: toolName(name), value: n, shown: fmtCount(n) }));
    if (rest.length) {
      const n = rest.reduce((sum, [, v]) => sum + v, 0);
      rows.push({ name: `${fmtCount(rest.length)} other tools`, value: n, shown: fmtCount(n) });
    }
    out.push(
      chartCard(
        "Tool uses, by name",
        [barList(rows, inner, "Tool uses by name, most used first", "uses")],
        `${plural(uses, "tool use")} by name, most used first, ${range}. It also started ${plural(u.subAgents, "sub-agent")}.`,
        tableView(["Tool", "Uses"], tools.map(([name, n]) => [toolName(name), fmtCount(n)])),
      ),
    );
  }
  return out;
}

// ------------------------------------------------------------------ prompts

function wordCard(title: string, rows: [string, number][], width: number, none: string, sentence: string): HTMLElement {
  if (rows.length === 0) return emptyCard(title, none);
  return chartCard(
    title,
    [barList(rows.map(([name, n]) => ({ name, value: n, shown: fmtCount(n) })), width, title, "times")],
    sentence,
    tableView([title, "Times"], rows.map(([name, n]) => [name, fmtCount(n)])),
  );
}

function renderPrompts(result: LoadResult, width: number): HTMLElement[] {
  const { screens, report } = result;
  const p = screens.prompts;
  if (!p || !report?.range) return [emptyCard("No prompts to count", "There is no prompt history to count yet.")];
  const out: HTMLElement[] = [];
  const reading = result.state.sources.some((s) => s.reading !== null);
  const range = fromTo(report.range);
  // A prompt whose time came from a transcript has no text here: only its time was taken.
  const noText = result.fromTranscripts > 0 && result.fromTranscripts >= p.count;
  const notRead = reading ? "Still reading" : noText ? "No prompt history" : "Not read this time";

  out.push(heading("Counts"));
  out.push(
    tiles(
      "four",
      tile("Prompts", fmtCount(p.count), "", "Typed, in all your history"),
      tile(
        "Busiest hour",
        p.busiestHour ? fmtHour(p.busiestHour.hour) : null,
        "",
        p.busiestHour ? `${plural(p.busiestHour.prompts, "prompt")} typed in that hour` : "",
        notRead,
      ),
      tile("Longest prompt", p.lengths ? fmtCount(p.lengths.longest.chars) : null, "characters", p.lengths ? fmtDay(p.lengths.longest.day) : "", notRead),
      tile("Typical prompt", p.lengths ? fmtCount(Math.round(p.lengths.median)) : null, "characters", p.lengths ? "Half your prompts are longer" : "", notRead),
    ),
  );
  out.push(
    node(
      "p",
      "note",
      `${range}. Lengths and dates only: a prompt's text is never shown. A pasted block counts as the short marker Claude Code keeps in its place.`,
    ),
  );

  out.push(heading("Your words"));
  const words = screens.words;
  if (state.hideNames) {
    out.push(emptyCard("Hidden", "Your words are not shown while names are hidden. Turn Hide names off in Settings to see them."));
  } else if (!words) {
    out.push(
      emptyCard(
        reading ? "Reading your prompt history…" : "No words to show",
        reading
          ? "Your words are counted fresh each time the history is read, and never saved. They will be here when it lands."
          : noText
            ? "Words are counted from Claude Code's prompt history, which the terminal writes, and there is none here. From your transcripts only the times you typed are taken, never the text."
            : "Your words are counted fresh each time the history is read, and never saved. It could not be read this time.",
      ),
    );
  } else {
    const three = width >= 980;
    const two = !three && width >= 660;
    const box = node("div", three ? "pair three" : two ? "pair two" : "pair");
    const w = cardInner(three ? (width - 24) / 3 : two ? (width - 12) / 2 : width);
    box.append(
      wordCard("Words", words.words, w, "No word was used twice.", 'The words you typed most. Common ones like "the" and "to" are left out.'),
      wordCard("Two-word phrases", words.phrases, w, "No phrase was used twice.", "Two words side by side in one sentence, neither of them a common word."),
      wordCard("Slash commands", words.commands, w, "No prompt began with a slash command.", "The commands your prompts began with."),
    );
    out.push(box);
    const rest = p.count - words.prompts;
    const partial =
      rest <= 0
        ? ""
        : result.fromTranscripts >= rest
          ? " The rest were typed in sessions the prompt history does not hold: their times are taken from the transcripts and their text is not read."
          : " The rest are from a source that has not been read this time, or from transcripts, where only the time is taken.";
    out.push(
      node(
        "p",
        "note",
        `Counted just now from ${plural(words.prompts, "prompt")} of ${fmtCount(p.count)}, in memory.${partial} Nothing on this page is saved: ` +
          "the words are counted when the history is read, shown, and dropped.",
      ),
    );
  }
  return out;
}

// ----------------------------------------------------------------- projects

// Projects left out of the sum by unticking them, by name. Forgotten when the app closes.
const unticked = new Set<string>();

function renderProjects(result: LoadResult, width: number): HTMLElement[] {
  const list = result.screens.projects;
  const u = result.usage;
  if (list.length === 0) {
    return [emptyCard("No projects to show", "Claude Code notes the folder each prompt was typed in. No prompt with a folder has been read yet.")];
  }
  const out: HTMLElement[] = [];
  for (const name of [...unticked]) if (!list.some((p) => p.name === name)) unticked.delete(name);

  const narrow = width < 600;
  const most = Math.max(...list.map((p) => p.hours), 0) || 1;
  const barW = narrow ? 0 : Math.min(160, Math.round(width * 0.2));
  const sum = node("p", "sum");
  const total = () => {
    const ticked = list.filter((p) => !unticked.has(p.name));
    const hours = ticked.reduce((s, p) => s + p.hours, 0);
    const prompts = ticked.reduce((s, p) => s + p.prompts, 0);
    const tokens = ticked.reduce((s, p) => s + (p.tokens ?? 0), 0);
    sum.textContent =
      `${ticked.length === list.length ? `All ${plural(list.length, "project")}` : `${fmtCount(ticked.length)} of ${plural(list.length, "project")} ticked`}: ` +
      `${fmtNumber(hours)} hours, ${plural(prompts, "prompt")}` +
      (u ? `, ${fmtBig(tokens)} tokens since ${fmtDay(u.range.from)}.` : ".");
  };

  const table = node("table", "projects");
  const head = node("tr");
  const headers: [string, string][] = [
    ["", "tick"],
    ["Project", ""],
    ["Hours", "num"],
    ["Days", "num"],
    ["Prompts", "num"],
  ];
  if (u) headers.push(["Tokens", "num"]);
  for (const [text, cls] of headers) {
    if (narrow && text === "Days") continue;
    const th = node("th", cls, text);
    th.scope = "col";
    if (text === "Hours" && barW) th.colSpan = 2;
    head.append(th);
  }
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  list.forEach((p, i) => {
    const tr = node("tr");
    const box = node("input");
    box.type = "checkbox";
    box.id = `project-${i}`;
    box.checked = !unticked.has(p.name);
    box.addEventListener("change", () => {
      if (box.checked) unticked.delete(p.name);
      else unticked.add(p.name);
      tr.classList.toggle("off", !box.checked);
      total();
    });
    tr.classList.toggle("off", !box.checked);
    const tick = node("td", "tick");
    tick.append(box);
    const name = node("th", "name");
    name.scope = "row";
    const label = node("label", "", p.name);
    label.htmlFor = box.id;
    label.title = p.name;
    name.append(label);
    tr.append(tick, name);
    if (barW) {
      const cell = node("td", "bar");
      const w = Math.max(p.hours > 0 ? 2 : 0, (p.hours / most) * barW);
      const r = Math.min(4, w / 2);
      cell.style.width = `${barW + 10}px`;
      const svg = svgNode("svg", { width: barW, height: 12, viewBox: `0 0 ${barW} 12`, "aria-hidden": "true" }, "chart");
      if (w > 0) svg.append(svgNode("path", { d: `M0,1H${w - r}Q${w},1 ${w},${1 + r}V${11 - r}Q${w},11 ${w - r},11H0Z` }, "s1"));
      cell.append(svg);
      tr.append(cell);
    }
    if (p.prompts === 0 && p.tokens !== null) {
      // A session ran here and no prompt names the folder: said in words, in place of a row of zeros.
      const none = node("td", "none", "No prompt typed here");
      none.colSpan = (barW ? 1 : 0) + (narrow ? 2 : 3);
      if (barW) tr.lastElementChild?.remove();
      tr.append(none);
    } else {
      tr.append(node("td", "num", fmtNumber(p.hours)));
      if (!narrow) tr.append(node("td", "num", fmtCount(p.activeDays)));
      tr.append(node("td", "num", fmtCount(p.prompts)));
    }
    if (u) tr.append(node("td", "num", p.tokens === null ? "–" : fmtBig(p.tokens)));
    body.append(tr);
  });
  table.append(thead, body);
  total();

  const card = node("section", "card chart-card");
  card.append(node("h3", "", "Hours and prompts, by project"));
  const one = result.screens.oneFolder;
  if (one) {
    card.append(
      node(
        "p",
        "lead-note",
        `Most of your prompts were typed in one folder, so there is little here to split: the first row holds ${fmtNumber(one.hours)} of the ${fmtNumber(one.of)} hours below.`,
      ),
    );
  }
  card.append(sum, table);
  const range = result.report?.range ? fromTo(result.report.range) : "";
  const notes = [
    `Prompting hours and prompts by the folder each prompt was typed in, most hours first, ${range}. The name is the last part of the folder's path.`,
    "Each project's hours are cut from its own prompts, so time spent in two projects at once is in both.",
  ];
  if (u) notes.push(`Tokens include cache reads and cover ${fromTo(u.range)}, the days the transcripts reach; a dash means no transcript ran there.`);
  if (list.some((p) => p.prompts === 0 && p.tokens !== null)) {
    notes.push("\u201cNo prompt typed here\u201d is a folder a session ran in that none of your prompts names, so it has tokens and no hours of its own.");
  }
  notes.push("Untick a project to leave it out of the sum above. Every other page shows all your usage.");
  if (state.hideNames) notes.push("Names are hidden: projects are numbered in order of hours.");
  card.append(node("p", "note", notes.join(" ")));
  out.push(card);
  return out;
}
