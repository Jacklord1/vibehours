// Made-up stores in scratch folders only.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { STORE_VERSION, emptyStore, loadStore, saveStore, type Store } from "../src/main/store";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibehours-test-"));
}

function madeUp(): Store {
  const store = emptyStore("Europe/London");
  store.sources["ssh:shed"] = {
    prompts: { readAt: 1, spans: [[10, 20, 3]], dropped: 0, badLines: 0 },
    transcriptsReadAt: 2,
    files: {
      "p/a.jsonl": {
        size: 500,
        session: "session-a",
        folder: "/made/up",
        sub: false,
        runs: [[10, 20]],
        away: [],
        days: { "2026-03-02": { models: { "claude-made-up-1": [1, 2, 3, 4, 1] }, tools: {} } },
        ids: ["abc"],
        costs: [],
        lines: 1,
        bad: 0,
      },
    },
  };
  return store;
}

test("no store yet is an empty one, and nothing is set aside", () => {
  const dir = tempDir();
  assert.deepEqual(loadStore(dir, "UTC"), { store: emptyStore("UTC"), setAside: null, locked: false });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a store survives a round trip", () => {
  const dir = tempDir();
  saveStore(dir, madeUp());
  assert.deepEqual(loadStore(dir, "Europe/London"), { store: madeUp(), setAside: null, locked: false });
  assert.deepEqual(fs.readdirSync(dir), ["store.json"]);
});

test("a store that cannot be read is set aside, not overwritten", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "store.json"), '{"version":1,"zone":"UTC","sources":{"ssh:shed":{"fil');
  const loaded = loadStore(dir, "UTC", undefined, new Date(2026, 2, 2, 9, 5, 7));
  assert.deepEqual(loaded.store, emptyStore("UTC"));
  assert.equal(loaded.setAside, "store.unreadable-20260302-090507.json");
  assert.deepEqual(fs.readdirSync(dir), ["store.unreadable-20260302-090507.json"]);
  assert.match(fs.readFileSync(path.join(dir, loaded.setAside), "utf8"), /^\{"version":1,"zone":"UTC"/);

  // The new store is written beside it and the old file is still whole.
  saveStore(dir, loaded.store);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["store.json", "store.unreadable-20260302-090507.json"]);
});

test("a store in a shape that is not expected is set aside too", () => {
  for (const text of ["[]", '"words"', '{"version":1,"zone":"UTC","sources":{"ssh:shed":{"files":{"p/a.jsonl":{"size":"big"}}}}}']) {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "store.json"), text);
    const loaded = loadStore(dir, "UTC");
    assert.ok(loaded.setAside);
    assert.equal(fs.readFileSync(path.join(dir, loaded.setAside), "utf8"), text);
  }
});

test("a store from an older version is brought up a version at a time", () => {
  const dir = tempDir();
  // A made-up older shape: version 0 kept its sources under another name.
  const old = { version: STORE_VERSION - 1, zone: "Europe/London", boxes: madeUp().sources };
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(old));
  const upgrades = {
    [STORE_VERSION - 1]: (o: Record<string, unknown>) => ({ version: STORE_VERSION, zone: o.zone, sources: o.boxes }),
  };
  assert.deepEqual(loadStore(dir, "Europe/London", upgrades), { store: madeUp(), setAside: null, locked: false });
});

test("a store from a version there is no step for, older or newer, is set aside and kept", () => {
  for (const version of [0, STORE_VERSION + 1]) {
    const dir = tempDir();
    const text = JSON.stringify({ ...madeUp(), version });
    fs.writeFileSync(path.join(dir, "store.json"), text);
    const loaded = loadStore(dir, "Europe/London");
    assert.deepEqual(loaded.store, emptyStore("Europe/London"));
    assert.ok(loaded.setAside);
    assert.equal(fs.readFileSync(path.join(dir, loaded.setAside), "utf8"), text);
  }
});

test("a version 1 store is brought up: its stretches of prompts are kept until the source is read again", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify({ ...madeUp(), version: 1 }));
  const loaded = loadStore(dir, "Europe/London");
  assert.equal(loaded.setAside, null);
  assert.equal(loaded.store.version, STORE_VERSION);
  assert.deepEqual(loaded.store.sources["ssh:shed"].prompts?.spans, [[10, 20, 3]]);
  assert.deepEqual(Object.keys(loaded.store.sources["ssh:shed"].files), ["p/a.jsonl"]);
});

test("in a new home zone every file is marked to be read again, and what it gave is kept until then", () => {
  const dir = tempDir();
  saveStore(dir, madeUp());
  const { store } = loadStore(dir, "Pacific/Auckland");
  assert.equal(store.zone, "Pacific/Auckland");
  const file = store.sources["ssh:shed"].files["p/a.jsonl"];
  assert.equal(file.size, -1);
  assert.deepEqual(Object.keys(file.days), ["2026-03-02"]);
});
