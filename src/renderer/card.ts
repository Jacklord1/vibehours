// The share picture and the monthly card, drawn on a canvas so they can be
// saved as a PNG or copied.
//
// Everything written on the picture comes from the card the shell sent,
// which is made of totals and fixed words: no project, no source, no path
// and nothing the user typed. Nothing else is drawn here. Colours are the
// page's own, so the picture is light or dark as the app is.

type Card = import("../engine/insights").Card;

const CARD_W = 1200;
const CARD_H = 630;
const CARD_FONT = 'system-ui, "Segoe UI", sans-serif';
// The picture is looked at on a phone, where its 630 rows are a few
// centimetres. Nothing on it is set smaller than CARD_PX.least.
const CARD_PX = {
  name: 30,
  period: 24,
  heading: 52,
  sub: 24,
  value: 48,
  unit: 24,
  measure: 22,
  key: 22,
  line: 26,
  foot: 22,
  least: 22,
} as const;

function themeColour(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** What the picture says, for someone who cannot see it. */
function cardLabel(card: Card): string {
  return [
    card.name,
    card.heading,
    card.sub,
    card.period,
    ...card.figures.map((f) => `${f.measure}: ${f.value} ${f.unit}`.trim()),
    card.line ?? "",
    card.squaresNote,
  ]
    .filter((s) => s !== "")
    .join(". ");
}

function drawCard(canvas: HTMLCanvasElement, card: Card): void {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", cardLabel(card));
  const g = canvas.getContext("2d");
  if (!g) return;

  const text = themeColour("--text");
  const muted = themeColour("--muted");
  const left = 56;
  const right = CARD_W - 56;
  const font = (px: number, weight = 400) => {
    g.font = `${weight} ${px}px ${CARD_FONT}`;
  };
  const write = (s: string, x: number, y: number, colour: string, align: CanvasTextAlign = "left", room?: number) => {
    g.fillStyle = colour;
    g.textAlign = align;
    g.fillText(s, x, y, room);
  };
  const wrap = (s: string, max: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const word of s.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  // Text is never cut short: it is set smaller until it fits the room it
  // has. At the least size it is set narrower instead, never lower: the
  // lines are broken as if the room were wider and each is drawn into `max`.
  const fitted = (s: string, px: number, weight: number, max: number, most: number): { lines: string[]; px: number } => {
    for (let size = px; size >= CARD_PX.least; size--) {
      font(size, weight);
      const lines = wrap(s, max);
      if (lines.length <= most) return { lines, px: size };
    }
    for (let wider = max; ; wider *= 1.05) {
      const lines = wrap(s, wider);
      if (lines.length <= most) return { lines, px: CARD_PX.least };
    }
  };

  g.fillStyle = themeColour("--surface");
  g.fillRect(0, 0, CARD_W, CARD_H);
  g.textBaseline = "alphabetic";

  font(CARD_PX.name, 600);
  write(card.name, left, 66, text);
  const nameW = g.measureText(card.name).width;
  const periodRoom = right - left - nameW - 40;
  const period = fitted(card.period, CARD_PX.period, 400, periodRoom, 1);
  write(period.lines[0], right, 66, muted, "right", periodRoom);

  const heading = fitted(card.heading, CARD_PX.heading, 700, right - left, 1);
  write(heading.lines[0], left, 122, text, "left", right - left);
  if (card.sub) {
    const sub = fitted(card.sub, CARD_PX.sub, 400, right - left, 1);
    write(sub.lines[0], left, 156, muted, "left", right - left);
  }

  // The figures: three across, two down. Each is a value, its unit, and what it measures.
  const colW = (right - left) / 3;
  card.figures.slice(0, 6).forEach((figure, i) => {
    const x = left + (i % 3) * colW;
    const y = 216 + Math.floor(i / 3) * 112;
    const value = fitted(figure.value, CARD_PX.value, 700, colW - 24, 1);
    write(value.lines[0], x, y, text, "left", colW - 24);
    const valueW = Math.min(g.measureText(value.lines[0]).width, colW - 24);
    if (figure.unit) {
      const unitRoom = Math.max(60, colW - 24 - valueW - 10);
      const unit = fitted(figure.unit, CARD_PX.unit, 400, unitRoom, 1);
      write(unit.lines[0], x + valueW + 10, y, muted, "left", unitRoom);
    }
    const measure = fitted(figure.measure, CARD_PX.measure, 400, colW - 24, 2);
    measure.lines.forEach((line, n) => write(line, x, y + 30 + n * 26, muted, "left", colW - 24));
  });

  // One square a day, a column a week from Sunday down to Saturday.
  const top = 414;
  const pitch = 15;
  const size = pitch - 3;
  const dayNumber = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  // Day 0 was a Thursday, so day 3 was a Sunday.
  const weekdayOf = (n: number) => (((n - 3) % 7) + 7) % 7;
  let squaresEnd = left;
  if (card.squares.length) {
    const first = dayNumber(card.squares[0].day);
    const firstSunday = first - weekdayOf(first);
    const levels = [0, 1, 2, 3, 4].map((n) => themeColour(`--sq-${n}`));
    const outline = themeColour("--axis");
    for (const square of card.squares) {
      const n = dayNumber(square.day);
      const x = left + Math.floor((n - firstSunday) / 7) * pitch;
      const y = top + weekdayOf(n) * pitch;
      g.beginPath();
      g.roundRect(x, y, size, size, 3);
      if (square.out) {
        g.strokeStyle = outline;
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.fillStyle = levels[square.level];
        g.fill();
      }
      squaresEnd = Math.max(squaresEnd, x + size);
    }
    // What the shades mean, beside the squares.
    font(CARD_PX.key);
    const keySize = 14;
    const keyW = Math.max(...card.squaresKey.map((name) => g.measureText(name).width));
    const keyX = right - keyW - keySize - 10;
    card.squaresKey.forEach((name, i) => {
      const y = top + i * 26;
      g.beginPath();
      g.roundRect(keyX, y, keySize, keySize, 3);
      g.fillStyle = levels[i];
      g.fill();
      font(CARD_PX.key);
      write(name, keyX + keySize + 10, y + 14, muted);
    });
    // The one line, in the room between the squares and their key.
    if (card.line) {
      const room = keyX - 40 - (squaresEnd + 40);
      if (room >= 300) {
        const line = fitted(card.line, CARD_PX.line, 400, room, 3);
        line.lines.forEach((l, n) => write(l, squaresEnd + 40, top + 30 + n * (line.px + 8), text, "left", room));
      }
    }
  }

  // The two foot lines, one under the other: side by side they only fit
  // at a size too small to read on a phone.
  const note = fitted(card.squaresNote, CARD_PX.foot, 400, right - left, 1);
  write(note.lines[0], left, 572, muted, "left", right - left);
  const footer = fitted(card.footer, CARD_PX.foot, 400, right - left, 1);
  write(footer.lines[0], left, 602, muted, "left", right - left);
}
