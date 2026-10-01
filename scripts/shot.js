// Runs the real app, waits for the screen to settle, saves a picture of the
// window and quits. For looking at the app on a box with no display:
//
//   npx electron --no-sandbox --ozone-platform=headless scripts/shot.js \
//     <out.png> [light|dark] [user-data-dir] [steps.json] [WIDTHxHEIGHT] [snap-after-ms]
//
// steps.json is a list of JavaScript strings run in the page one at a time,
// such as a click; the screen settles after each. With no steps the picture
// is of the screen the app opens on. With snap-after-ms the picture is taken
// that long after the page loads, without waiting for it to settle: that is
// how a screen that is still reading is seen.
//
// With SHOT_CANVAS=<file.png> set, the share picture or card that is open is
// also saved as its own PNG, the same pixels Save as PNG writes.
//
// HOME decides which Claude Code and SSH files the app finds. Point it at a
// made-up folder unless you mean to look at your real numbers, and keep
// pictures of real numbers out of the repo.

const { app, nativeTheme } = require("electron");
const fs = require("node:fs");

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("shot.js")) + 1);
const [out, theme, userData, stepsFile, size, snapAfter] = args;
if (!out) {
  console.error("usage: electron scripts/shot.js <out.png> [light|dark] [user-data-dir] [steps.json] [WxH] [snap-after-ms]");
  process.exit(2);
}
if (userData) app.setPath("userData", userData);
if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
const steps = stepsFile && stepsFile !== "-" ? JSON.parse(fs.readFileSync(stepsFile, "utf8")) : [];
const [width, height] = (size || "920x760").split("x").map(Number);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

app.on("browser-window-created", (_event, win) => {
  // A headless window opens at its minimum size; put it back.
  win.setSize(width, height);
  win.webContents.once("did-finish-load", async () => {
    const settle = async () => {
      await pause(150);
      for (let i = 0; i < 300; i++) {
        if (await win.webContents.executeJavaScript("document.body.dataset.busy === '0'")) break;
        await pause(100);
      }
      await pause(300);
    };
    if (snapAfter) await pause(Number(snapAfter));
    else await settle();
    for (const step of steps) {
      await win.webContents.executeJavaScript(step);
      await settle();
    }
    // The share picture or card itself, as it would be saved: the canvas's own PNG.
    if (process.env.SHOT_CANVAS) {
      const url = await win.webContents.executeJavaScript('document.getElementById("card-canvas").toDataURL("image/png")');
      fs.writeFileSync(process.env.SHOT_CANVAS, Buffer.from(url.split(",")[1], "base64"));
    }
    const image = await win.webContents.capturePage();
    fs.writeFileSync(out, image.toPNG());
    const shot = image.getSize();
    console.log(`saved ${shot.width}x${shot.height}`);
    app.quit();
  });
});

require("../dist/src/main/main.js");
