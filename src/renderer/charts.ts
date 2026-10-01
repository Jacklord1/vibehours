// The charts, drawn here in SVG. No chart library and nothing loaded.
//
// Colour comes from classes in the stylesheet, so light and dark are chosen
// there. Geometry is set here, at the width the page has, and the page is
// drawn again when its width changes. Every mark answers to the pointer and
// to the keyboard with the same readout, and every chart has a table of the
// same numbers under it.

const SVG_NS = "http://www.w3.org/2000/svg";

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  className = "",
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
  if (className) n.setAttribute("class", className);
  return n;
}

function svgText(x: number, y: number, text: string, className: string, anchor = "start"): SVGTextElement {
  const t = svgNode("text", { x, y, "text-anchor": anchor }, className);
  t.textContent = text;
  return t;
}

// ------------------------------------------------------------------ readout

interface TipRow {
  /** The class of the series' colour, for a key beside the row. */
  key?: string;
  value: string;
  name: string;
}

interface Mark {
  /** What is lit while the readout is up. */
  lit: SVGElement;
  /** What the pointer has to be over: bigger than the mark itself. */
  hit: SVGElement;
  title: string;
  rows: TipRow[];
}

function showTip(anchor: Element, title: string, rows: TipRow[]): void {
  const tip = document.getElementById("tip") as HTMLElement;
  const lines: HTMLElement[] = [];
  if (title) {
    const head = document.createElement("div");
    head.className = "tip-title";
    head.textContent = title;
    lines.push(head);
  }
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "tip-row";
    if (row.key) {
      const key = document.createElement("span");
      key.className = `key ${row.key}`;
      line.append(key);
    }
    const value = document.createElement("strong");
    value.textContent = row.value;
    const name = document.createElement("span");
    name.textContent = row.name;
    line.append(value, name);
    lines.push(line);
  }
  tip.replaceChildren(...lines);
  tip.hidden = false;
  // Above the mark and centred on it, kept inside the window.
  const box = anchor.getBoundingClientRect();
  const size = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left + box.width / 2 - size.width / 2), window.innerWidth - size.width - 8);
  const above = box.top - size.height - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${above >= 8 ? above : box.bottom + 8}px`;
}

function hideTip(): void {
  (document.getElementById("tip") as HTMLElement).hidden = true;
}

/**
 * Gives a chart its readout. The pointer shows the mark it is over. The
 * chart is one stop for the Tab key; the arrow keys then walk its marks.
 * `step` says where an arrow key leads from a mark, for a grid.
 */
function wire(svg: SVGSVGElement, marks: Mark[], step?: (from: number, key: string) => number): void {
  if (marks.length === 0) return;
  let at = -1;
  const show = (i: number) => {
    if (at >= 0) marks[at].lit.classList.remove("on");
    at = i;
    marks[i].lit.classList.add("on");
    showTip(marks[i].lit, marks[i].title, marks[i].rows);
  };
  const clear = () => {
    if (at >= 0) marks[at].lit.classList.remove("on");
    hideTip();
  };
  marks.forEach((mark, i) => {
    mark.hit.addEventListener("pointerenter", () => show(i));
    mark.hit.addEventListener("pointerleave", clear);
  });
  svg.setAttribute("tabindex", "0");
  svg.addEventListener("focus", () => show(at >= 0 ? at : marks.length - 1));
  svg.addEventListener("blur", clear);
  svg.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return clear();
    if (!event.key.startsWith("Arrow") && event.key !== "Home" && event.key !== "End") return;
    const from = at >= 0 ? at : marks.length - 1;
    let to = from;
    if (event.key === "Home") to = 0;
    else if (event.key === "End") to = marks.length - 1;
    else if (step) to = step(from, event.key);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = from - 1;
    else to = from + 1;
    event.preventDefault();
    if (to >= 0 && to < marks.length) show(to);
  });
}

// ------------------------------------------------------------------ columns

interface ColumnItem {
  /** The readout's heading, such as a date. */
  title: string;
  /** One value per series, stacked from the baseline up. */
  values: number[];
  /** Written under the column. Leave most of them out. */
  tick?: string;
}

interface ColumnOptions {
  width: number;
  height?: number;
  /** What the chart is, for a screen reader. */
  label: string;
  items: ColumnItem[];
  /** Name and colour class of each series: `s1`, `s2`. */
  series: { name: string; cls: string }[];
  format: (n: number) => string;
  /** How a step on the value axis is written, when not as `format` writes it. */
  tick?: (n: number) => string;
  /** Whole numbers only on the value axis. */
  whole?: boolean;
}

/** Round steps for an axis: 1, 2 or 5 times a power of ten. */
function axisSteps(max: number, whole: boolean): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  if (whole) step = Math.max(1, Math.round(step));
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

/** A column with a rounded top and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function columnChart(o: ColumnOptions): SVGSVGElement {
  const height = o.height ?? 180;
  const left = 46;
  const right = 6;
  const top = 8;
  const bottom = 26;
  const plotW = Math.max(40, o.width - left - right);
  const plotH = height - top - bottom;
  const svg = svgNode("svg", { width: o.width, height, viewBox: `0 0 ${o.width} ${height}`, role: "img", "aria-label": o.label }, "chart");

  const totals = o.items.map((item) => item.values.reduce((s, v) => s + v, 0));
  const ticks = axisSteps(Math.max(...totals, 0), o.whole === true);
  const topValue = ticks[ticks.length - 1] || 1;
  const yOf = (v: number) => top + plotH - (v / topValue) * plotH;

  for (const tick of ticks) {
    const y = Math.round(yOf(tick)) + 0.5;
    svg.append(svgNode("line", { x1: left, x2: left + plotW, y1: y, y2: y }, tick === 0 ? "axis" : "grid"));
    svg.append(svgText(left - 8, y + 4, (o.tick ?? o.format)(tick), "tick", "end"));
  }

  const band = plotW / o.items.length;
  // Never the whole slot: what is left over is the air between columns.
  const thick = Math.max(1, Math.min(24, band - 2, band * 0.7));
  const marks: Mark[] = [];
  o.items.forEach((item, i) => {
    const x = left + band * i + (band - thick) / 2;
    const group = svgNode("g", {}, "col");
    let base = 0;
    const last = item.values.reduce((at, v, s) => (v > 0 ? s : at), -1);
    item.values.forEach((value, s) => {
      if (value <= 0) return;
      const y0 = yOf(base);
      const y1 = yOf(base + value);
      // Two pixels of surface between one segment and the next.
      const gap = base > 0 ? 2 : 0;
      const h = Math.max(1, y0 - y1 - gap);
      group.append(svgNode("path", { d: columnPath(x, y0 - gap - h, thick, h, s === last) }, o.series[s].cls));
      base += value;
    });
    svg.append(group);
    if (item.tick) {
      // Centred under its column, unless that would push it out past either end of the plot.
      const half = item.tick.length * 3.4;
      const centre = Math.min(Math.max(left + band * (i + 0.5), left + half), left + plotW - half);
      svg.append(svgText(centre, height - 6, item.tick, "tick", "middle"));
    }
    const hit = svgNode("rect", { x: left + band * i, y: top, width: band, height: plotH }, "hit");
    svg.append(hit);
    marks.push({
      lit: group,
      hit,
      title: item.title,
      rows: item.values.map((value, s) => ({
        key: o.series.length > 1 ? o.series[s].cls : undefined,
        value: o.format(value),
        name: o.series[s].name,
      })),
    });
  });
  wire(svg, marks);
  return svg;
}

// --------------------------------------------------------------- bar lists

interface BarRow {
  name: string;
  value: number;
  /** The value as written at the bar's end. */
  shown: string;
}

/** Named bars, longest first as given, each with its value written at its end. */
function barList(rows: BarRow[], width: number, label: string, what: string): SVGSVGElement {
  const rowH = 26;
  // Room for the longest name, up to nearly half the width. About seven pixels a letter.
  const longest = Math.max(...rows.map((r) => r.name.length), 4);
  const nameW = Math.round(Math.min(longest * 7 + 14, width * 0.46));
  const valueW = 64;
  const trackW = Math.max(20, width - nameW - valueW - 10);
  const height = rows.length * rowH;
  const svg = svgNode("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label }, "chart");
  const most = Math.max(...rows.map((r) => r.value), 0) || 1;
  // A name too long for that is cut, and kept whole in the readout and the table.
  const fits = Math.max(4, Math.floor((nameW - 8) / 7));
  const marks: Mark[] = [];
  rows.forEach((row, i) => {
    const y = i * rowH;
    const group = svgNode("g", {}, "col");
    const name = row.name.length > fits ? `${row.name.slice(0, fits - 1)}…` : row.name;
    svg.append(svgText(0, y + 17, name, "name"));
    const w = Math.max(2, (row.value / most) * trackW);
    const r = Math.min(4, w / 2);
    group.append(
      svgNode("path", { d: `M${nameW},${y + 8}H${nameW + w - r}Q${nameW + w},${y + 8} ${nameW + w},${y + 8 + r}V${y + 18 - r}Q${nameW + w},${y + 18} ${nameW + w - r},${y + 18}H${nameW}Z` }, "s1"),
    );
    svg.append(group, svgText(nameW + w + 8, y + 17, row.shown, "tick"));
    const hit = svgNode("rect", { x: 0, y, width, height: rowH }, "hit");
    svg.append(hit);
    marks.push({ lit: group, hit, title: row.name, rows: [{ value: row.shown, name: what }] });
  });
  wire(svg, marks);
  return svg;
}

// ---------------------------------------------------------- a year of squares

interface SquareCell {
  /** A day key. */
  day: string;
  title: string;
  /** Null for a day outside the history. */
  shown: string | null;
  level: number;
}

/** One square a day, a column a week from Sunday down to Saturday. */
function squaresChart(cells: SquareCell[], width: number, label: string, weekdayNames: string[], monthOf: (day: string) => string): SVGSVGElement {
  const dayNumber = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  const weekdayOf = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  const first = dayNumber(cells[0].day) - weekdayOf(cells[0].day);
  const columnOf = (day: string) => Math.floor((dayNumber(day) - first) / 7);
  const columns = columnOf(cells[cells.length - 1].day) + 1;

  const left = 34;
  const top = 18;
  const pitch = Math.min(18, (width - left) / columns);
  const size = Math.max(2, pitch - 2);
  const height = Math.ceil(top + pitch * 7);
  const svg = svgNode("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label }, "chart squares");

  for (const row of [1, 3, 5]) svg.append(svgText(0, top + pitch * row + size / 2 + 4, weekdayNames[row], "tick"));

  const marks: Mark[] = [];
  let lastLabelAt = -100;
  for (const cell of cells) {
    const column = columnOf(cell.day);
    const x = left + column * pitch;
    const y = top + weekdayOf(cell.day) * pitch;
    // A month is named over the column its first day falls in.
    if (cell.day.endsWith("-01") && x - lastLabelAt >= 30 && x + 28 <= width) {
      svg.append(svgText(x, 11, monthOf(cell.day), "tick"));
      lastLabelAt = x;
    }
    const square = svgNode(
      "rect",
      { x: x + 0.5, y: y + 0.5, width: size, height: size, rx: Math.min(3, size / 4) },
      cell.shown === null ? "sq out" : `sq l${cell.level}`,
    );
    const hit = svgNode("rect", { x: x - 1, y: y - 1, width: pitch, height: pitch }, "hit");
    svg.append(square, hit);
    marks.push({ lit: square, hit, title: cell.title, rows: [{ value: cell.shown ?? "No history", name: cell.shown === null ? "for this day" : "" }] });
  }
  wire(svg, marks, (from, key) => from + (key === "ArrowLeft" ? -7 : key === "ArrowRight" ? 7 : key === "ArrowUp" ? -1 : 1));
  return svg;
}

// ------------------------------------------------------- the parts around a chart

/** The same numbers as the chart, as a table, closed until asked for. */
function tableView(headers: string[], rows: string[][]): HTMLElement {
  const details = node("details", "table-view");
  details.append(node("summary", "", "Show as a table"));
  const table = node("table");
  const head = node("tr");
  headers.forEach((h, i) => {
    const th = node("th", i === 0 ? "" : "num", h);
    th.scope = "col";
    head.append(th);
  });
  const thead = node("thead");
  thead.append(head);
  const tbody = node("tbody");
  for (const row of rows) {
    const tr = node("tr");
    row.forEach((cell, i) => tr.append(node(i === 0 ? "th" : "td", i === 0 ? "" : "num", cell)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const scroll = node("div", "table-scroll");
  scroll.append(table);
  details.append(scroll);
  return details;
}

/** A key for a chart with more than one series, or for the squares. */
function legend(items: { cls: string; name: string }[]): HTMLElement {
  const list = node("ul", "legend");
  for (const item of items) {
    const li = node("li");
    li.append(node("span", `key ${item.cls}`), item.name);
    list.append(li);
  }
  return list;
}

/**
 * A chart in its card: a title, the chart, a plain sentence saying what it
 * shows and over which dates, and the table. With no chart it says why,
 * rather than drawing an empty axis.
 */
function chartCard(title: string, parts: (Node | null)[], sentence: string, table?: HTMLElement): HTMLElement {
  const card = node("section", "card chart-card");
  card.append(node("h3", "", title));
  for (const part of parts) if (part) card.append(part);
  card.append(node("p", "note", sentence));
  if (table) card.append(table);
  return card;
}
