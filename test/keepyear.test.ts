// Every file here is made up, in a scratch folder. No test may ever be
// pointed at a real Claude Code settings file.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { applyKeepYear, claudeSettingsPath, inspectKeepYear, withKey } from "../src/main/keepyear";

function scratch(content?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibehours-keepyear-"));
  const file = path.join(dir, "settings.json");
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

function filesBeside(file: string): string[] {
  return fs.readdirSync(path.dirname(file)).sort();
}

const NOW = new Date(2026, 2, 4, 9, 5, 7);

test("the settings file is in the Claude Code folder, or where CLAUDE_CONFIG_DIR says", () => {
  assert.equal(claudeSettingsPath({}, "/home/sam"), path.join("/home/sam", ".claude", "settings.json"));
  assert.equal(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "/data/cc" }, "/home/sam"), path.join("/data/cc", "settings.json"));
});

test("the key is added, nothing else changes, and a copy is made first", () => {
  const before = '{\n  "model": "sonnet",\n  "permissions": {\n    "allow": ["Bash(ls:*)"]\n  }\n}\n';
  const file = scratch(before);
  assert.deepEqual(inspectKeepYear(file), { state: "can-add" });

  const result = applyKeepYear(file, NOW);
  const backup = `${file}.before-vibehours-20260304-090507`;
  assert.deepEqual(result, { done: true, backup });
  assert.equal(fs.readFileSync(backup, "utf8"), before);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    '{\n  "cleanupPeriodDays": 365,\n  "model": "sonnet",\n  "permissions": {\n    "allow": ["Bash(ls:*)"]\n  }\n}\n',
  );
  assert.deepEqual(filesBeside(file), ["settings.json", "settings.json.before-vibehours-20260304-090507"]);
  assert.deepEqual(inspectKeepYear(file), { state: "has-key", value: 365 });
});

test("the file's own indent and line endings are kept", () => {
  assert.equal(withKey('{\r\n\t"a": 1\r\n}\r\n'), '{\r\n\t"cleanupPeriodDays": 365,\r\n\t"a": 1\r\n}\r\n');
  assert.equal(withKey('{"a":1}'), '{"cleanupPeriodDays": 365, "a":1}');
  assert.equal(withKey("{}\n"), '{\n  "cleanupPeriodDays": 365\n}\n');
  assert.equal(withKey("{\n}\n"), '{\n  "cleanupPeriodDays": 365\n}\n');
  for (const text of ['{\r\n\t"a": 1\r\n}\r\n', '{"a":1}', "{}\n", "  {\n    \"a\": {\"b\": [1, 2]}\n  }"]) {
    assert.deepEqual(JSON.parse(withKey(text)), { cleanupPeriodDays: 365, ...JSON.parse(text) });
  }
});

test("an empty settings object gets the key", () => {
  const file = scratch("{}");
  assert.equal(applyKeepYear(file, NOW).done, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { cleanupPeriodDays: 365 });
});

test("no settings file: on yes one is made, holding the one key and nothing else", () => {
  const file = scratch();
  assert.deepEqual(inspectKeepYear(file), { state: "no-file" });
  assert.deepEqual(applyKeepYear(file, NOW), { done: true, backup: null });
  assert.equal(fs.readFileSync(file, "utf8"), '{\n  "cleanupPeriodDays": 365\n}\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { cleanupPeriodDays: 365 });
  // No copy is made of a file that was not there, and nothing else is written.
  assert.deepEqual(filesBeside(file), ["settings.json"]);
  // Asked again, the file it made is left alone.
  assert.deepEqual(applyKeepYear(file, NOW), { done: false, why: "has-key", value: 365 });
  assert.deepEqual(filesBeside(file), ["settings.json"]);
});

test("no settings file and no Claude Code folder: nothing is made, not even the folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibehours-keepyear-"));
  const file = path.join(dir, "not-there", "settings.json");
  assert.deepEqual(applyKeepYear(file, NOW), { done: false, why: "write-failed", detail: "ENOENT" });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("refused: the file is not valid JSON, and is not touched", () => {
  for (const text of ['{\n  // my note\n  "model": "sonnet"\n}\n', '{"model": "sonnet",}', "", "{half"]) {
    const file = scratch(text);
    assert.deepEqual(inspectKeepYear(file), { state: "not-json" });
    assert.deepEqual(applyKeepYear(file, NOW), { done: false, why: "not-json" });
    assert.equal(fs.readFileSync(file, "utf8"), text);
    assert.deepEqual(filesBeside(file), ["settings.json"]);
  }
});

test("refused: the file already has the key, whatever its value", () => {
  for (const value of [30, 365, 9999, "90", null]) {
    const text = JSON.stringify({ model: "sonnet", cleanupPeriodDays: value }, null, 2);
    const file = scratch(text);
    assert.deepEqual(inspectKeepYear(file), { state: "has-key", value });
    assert.deepEqual(applyKeepYear(file, NOW), { done: false, why: "has-key", value });
    assert.equal(fs.readFileSync(file, "utf8"), text);
    assert.deepEqual(filesBeside(file), ["settings.json"]);
  }
});

test("refused: the file is JSON but not a settings object", () => {
  for (const text of ["[]", '"text"', "null", "7"]) {
    const file = scratch(text);
    assert.deepEqual(applyKeepYear(file, NOW), { done: false, why: "not-object" });
    assert.equal(fs.readFileSync(file, "utf8"), text);
    assert.deepEqual(filesBeside(file), ["settings.json"]);
  }
});

test("a key of the same name deeper in the file does not count as set", () => {
  const file = scratch('{\n  "notes": { "cleanupPeriodDays": 1 }\n}\n');
  assert.deepEqual(inspectKeepYear(file), { state: "can-add" });
  assert.equal(applyKeepYear(file, NOW).done, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { cleanupPeriodDays: 365, notes: { cleanupPeriodDays: 1 } });
});

test("refused: a copy from the same second is already there, and the file is left alone", () => {
  const text = '{\n  "model": "sonnet"\n}\n';
  const file = scratch(text);
  fs.writeFileSync(`${file}.before-vibehours-20260304-090507`, "an earlier copy");
  const result = applyKeepYear(file, NOW);
  assert.equal(result.done, false);
  assert.equal(!result.done && result.why, "write-failed");
  assert.equal(fs.readFileSync(file, "utf8"), text);
  assert.equal(fs.readFileSync(`${file}.before-vibehours-20260304-090507`, "utf8"), "an earlier copy");
});

test("a file that starts with a byte-order mark keeps it", () => {
  const file = scratch('﻿{\n  "model": "sonnet"\n}\n');
  assert.equal(applyKeepYear(file, NOW).done, true);
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.startsWith("﻿{"));
  assert.deepEqual(JSON.parse(after.slice(1)), { cleanupPeriodDays: 365, model: "sonnet" });
});

// On Linux and macOS the home folder is whatever HOME says, which is how a
// made-up home stands in for a real one. Windows takes it from USERPROFILE.
const HOME_VAR = process.platform === "win32" ? "USERPROFILE" : "HOME";

function inHome<T>(home: string, run: () => T): T {
  const before = process.env[HOME_VAR];
  process.env[HOME_VAR] = home;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env[HOME_VAR];
    else process.env[HOME_VAR] = before;
  }
}

test("with nothing passed in, the offer finds the file under this PC's own home, and writes there and nowhere else", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibehours-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(file, '{\n  "model": "sonnet"\n}\n');
  inHome(home, () => {
    const saved = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      assert.equal(claudeSettingsPath(), file);
      assert.deepEqual(inspectKeepYear(claudeSettingsPath()), { state: "can-add" });
      const done = applyKeepYear(claudeSettingsPath(), NOW);
      assert.equal(done.done, true);
    } finally {
      if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { cleanupPeriodDays: 365, model: "sonnet" });
  assert.deepEqual(fs.readdirSync(home), [".claude"]);
  assert.deepEqual(filesBeside(file), ["settings.json", "settings.json.before-vibehours-20260304-090507"]);
});
