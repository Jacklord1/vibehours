// Prints the headline totals for a history file. Totals only: no prompt
// text is ever printed.
//
//   npm run hours -- <history.jsonl> <zone> [from YYYY-MM-DD] [to YYYY-MM-DD]

import * as fs from "node:fs";
import { reportFromText } from "../src/engine/hours";

const [file, zone, from, to] = process.argv.slice(2);
if (!file || !zone) {
  console.error("usage: hours <history.jsonl> <zone> [from] [to]");
  process.exit(2);
}

const report = reportFromText(fs.readFileSync(file, "utf8"), {
  zone,
  from,
  to,
  now: to ? undefined : Date.now(),
});

if (!report.range || !report.headline) {
  console.log("no data in range");
  process.exit(0);
}

const h = report.headline;
const n = (v: number | null, digits = 2) => (v === null ? "n/a" : v.toFixed(digits));
console.log(`zone            ${report.zone}`);
console.log(`range           ${report.range.from} to ${report.range.to}`);
console.log(`active days     ${h.activeDays} of ${h.totalDays}`);
console.log(`hours           ${n(h.totalHours)}`);
console.log(`big days        ${h.bigDays}`);
console.log(`median day      ${n(h.medianActiveDay)}`);
console.log(`typical big day ${n(h.typicalBigDay)}`);
console.log(`peak            ${n(h.peak.hours)} on ${h.peak.day}`);
console.log(`days a week     ${n(h.daysPerWeek)}`);
console.log(`big days a week ${n(h.bigDaysPerWeek)}`);
console.log(`weekly hours    ${n(h.weeklyHours)}`);
console.log(`current streak  ${h.currentStreak}`);
console.log(`longest streak  ${h.longestStreak.days} (${h.longestStreak.from} to ${h.longestStreak.to})`);
console.log(
  h.longestBreak
    ? `longest break   ${h.longestBreak.days} (${h.longestBreak.from} to ${h.longestBreak.to})`
    : "longest break   none",
);
console.log(`prompts         ${h.prompts}   dropped ${report.dropped}   bad lines ${report.badLines}`);
