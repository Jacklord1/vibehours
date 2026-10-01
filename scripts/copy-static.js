// tsc only emits JavaScript; the page's HTML and CSS are copied beside it.
const fs = require("node:fs");
const path = require("node:path");

const from = path.join(__dirname, "..", "src", "renderer");
const to = path.join(__dirname, "..", "dist", "src", "renderer");
fs.mkdirSync(to, { recursive: true });
for (const file of ["index.html", "style.css"]) {
  fs.copyFileSync(path.join(from, file), path.join(to, file));
}
