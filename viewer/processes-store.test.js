"use strict";
/*
 * The saved-processes store (contract C5, processes-store.js, used by
 * main.js): "Save as this process" writes atomically next to every process
 * saved before, a name saved again replaces its process (and the toast's Undo
 * brings the old one back), an unreadable store is an error and is never
 * replaced, and a failed write leaves the previous store in place.
 *
 * Every test runs against a real temp folder; the write-failure tests inject
 * a file system whose write or rename fails.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Store = require("./processes-store.js");

const _dirs = [];
test.after(() => { for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-processes-test-"));
  _dirs.push(dir);
  return Store.processesStorePath(dir);
}
const leftoverTemps = (p) => fs.existsSync(path.dirname(p))
  ? fs.readdirSync(path.dirname(p)).filter((n) => n.includes(".tmp-")) : [];

function failingFs(which) {
  return Object.assign({}, fs, {
    writeFileSync(p, data) {
      if (which === "write" && String(p).includes(".tmp-")) {
        const e = new Error("ENOSPC: no space left on device, write"); e.code = "ENOSPC"; throw e;
      }
      return fs.writeFileSync(p, data);
    },
    renameSync(from, to) {
      if (which === "rename") { const e = new Error("EXDEV: cross-device link not permitted, rename"); e.code = "EXDEV"; throw e; }
      return fs.renameSync(from, to);
    },
  });
}

const STEPS = [
  { draft_key: "chrome|Account lookup|Button:search", name: "Look up the customer", description: "By number.", waste: false },
  { draft_keys: ["sapgui|va01|MenuItem:check", "sapgui|va01|Button:create"], name: "Check and create the order", description: "", waste: true },
  { name: "Call the customer", description: "", waste: false, extra: "dropped" },
];

test("the store lives at <userData>/pdt-library/processes.json", () => {
  assert.equal(Store.processesStorePath(path.join("C:", "u")), path.join("C:", "u", "pdt-library", "processes.json"));
});

test("saveProcess creates the folder and the file in the C5 shape", () => {
  const p = tempStore();
  assert.equal(Store.readProcessesFile(p).status, "absent");
  const r = Store.saveProcess(p, { name: "  Order entry ", sourceSessionId: "sess-1", steps: STEPS },
    { now: "2026-09-23T10:00:00.000Z", uuid: "u-1" });
  assert.deepEqual(r, { path: p, id: "proc-u-1", previous: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf-8")), {
    version: 1,
    processes: [{
      id: "proc-u-1", name: "Order entry", saved_at: "2026-09-23T10:00:00.000Z", source_session_id: "sess-1",
      steps: [
        { draft_key: "chrome|Account lookup|Button:search", name: "Look up the customer", description: "By number.", waste: false },
        { draft_keys: ["sapgui|va01|MenuItem:check", "sapgui|va01|Button:create"], name: "Check and create the order", description: "", waste: true },
        { name: "Call the customer", description: "", waste: false },
      ],
    }],
  });
  assert.deepEqual(leftoverTemps(p), []);
});

test("a name saved again replaces its process and keeps its id; Undo brings the old one back", () => {
  const p = tempStore();
  Store.saveProcess(p, { name: "Order entry", steps: STEPS }, { now: "t1", uuid: "a" });
  Store.saveProcess(p, { name: "Returns", steps: STEPS.slice(0, 1) }, { now: "t2", uuid: "b" });
  const before = Store.readProcessesFile(p).processes;
  const r = Store.saveProcess(p, { name: "ORDER ENTRY", steps: STEPS.slice(0, 2) }, { now: "t3", uuid: "c" });
  assert.equal(r.id, "proc-a", "the replaced process keeps its id");
  assert.equal(r.previous.saved_at, "t1");
  const after = Store.readProcessesFile(p).processes;
  assert.deepEqual(after.map((x) => [x.id, x.name, x.steps.length]), [["proc-a", "ORDER ENTRY", 2], ["proc-b", "Returns", 1]]);
  assert.deepEqual(Store.undoSaveProcess(p, { id: r.id, previous: r.previous }), { path: p, changed: true });
  assert.deepEqual(Store.readProcessesFile(p).processes, before, "the replaced process is back as it was");
});

test("Undo of a new save removes it; an unknown id changes nothing", () => {
  const p = tempStore();
  Store.saveProcess(p, { name: "Kept", steps: STEPS }, { now: "t1", uuid: "k" });
  const r = Store.saveProcess(p, { name: "New", steps: STEPS }, { now: "t2", uuid: "n" });
  Store.undoSaveProcess(p, { id: r.id, previous: r.previous });
  assert.deepEqual(Store.readProcessesFile(p).processes.map((x) => x.id), ["proc-k"]);
  const text = fs.readFileSync(p, "utf-8");
  assert.deepEqual(Store.undoSaveProcess(p, { id: "proc-gone", previous: null }), { path: p, changed: false });
  assert.equal(fs.readFileSync(p, "utf-8"), text);
});

test("entries this version does not read are kept on disk untouched", () => {
  const p = tempStore();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ version: 1, processes: [{ id: "odd", note: "kept" }], extra: 1 }));
  assert.deepEqual(Store.readProcessesFile(p).processes, [], "an entry without a name and steps is not offered");
  Store.saveProcess(p, { name: "Order entry", steps: STEPS }, { now: "t", uuid: "x" });
  const doc = JSON.parse(fs.readFileSync(p, "utf-8"));
  assert.deepEqual(doc.processes[0], { id: "odd", note: "kept" });
  assert.equal(doc.extra, 1);
});

test("an unreadable store is reported and never replaced", () => {
  for (const bad of ['{"version":1,"processes":[', "[]", '{"version":2,"processes":[]}', '{"version":1,"processes":{}}',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"version":1,"processes":[]}')])]) {
    const p = tempStore();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bad);
    const before = fs.readFileSync(p);
    assert.equal(Store.readProcessesFile(p).status, "unreadable", "expected unreadable for " + JSON.stringify(String(bad)));
    assert.throws(() => Store.saveProcess(p, { name: "X", steps: STEPS }), (e) => e.code === "PROCESSES_UNREADABLE" && e.message.includes(p));
    assert.throws(() => Store.undoSaveProcess(p, { id: "proc-x" }), (e) => e.code === "PROCESSES_UNREADABLE");
    assert.deepEqual(fs.readFileSync(p), before, "the file is left exactly as it was");
  }
});

test("a failed write or rename leaves the previous store in place and no temp file behind", () => {
  for (const which of ["write", "rename"]) {
    const p = tempStore();
    Store.saveProcess(p, { name: "Order entry", steps: STEPS }, { now: "t1", uuid: "a" });
    const before = fs.readFileSync(p, "utf-8");
    assert.throws(() => Store.saveProcess(p, { name: "Other", steps: STEPS }, { fs: failingFs(which) }), which === "write" ? /ENOSPC/ : /EXDEV/);
    assert.equal(fs.readFileSync(p, "utf-8"), before);
    assert.deepEqual(leftoverTemps(p), []);
  }
});

test("forgetProcess removes one saved process and returns it as stored; Undo puts it back", () => {
  const p = tempStore();
  Store.saveProcess(p, { name: "Order entry", sourceSessionId: "s-1", steps: STEPS }, { now: "t1", uuid: "a" });
  Store.saveProcess(p, { name: "Returns", steps: STEPS.slice(0, 1) }, { now: "t2", uuid: "b" });
  const r = Store.forgetProcess(p, { id: "proc-a" });
  assert.equal(r.path, p);
  assert.equal(r.removed.id, "proc-a");
  assert.equal(r.removed.source_session_id, "s-1");
  assert.deepEqual(Store.readProcessesFile(p).processes.map((x) => x.id), ["proc-b"], "the other process stays");
  assert.deepEqual(Store.undoSaveProcess(p, { id: r.removed.id, previous: r.removed }), { path: p, changed: true });
  const back = Store.readProcessesFile(p).processes.find((x) => x.id === "proc-a");
  assert.equal(back.name, "Order entry");
  assert.equal(back.steps.length, 3);
  assert.deepEqual(leftoverTemps(p), []);
});

test("forgetProcess refuses an unknown id and an unreadable store, and changes nothing", () => {
  const p = tempStore();
  Store.saveProcess(p, { name: "Kept", steps: STEPS }, { now: "t1", uuid: "k" });
  const text = fs.readFileSync(p, "utf-8");
  assert.throws(() => Store.forgetProcess(p, { id: "proc-gone" }), /no longer on this computer/);
  assert.throws(() => Store.forgetProcess(p, {}), /no saved process was named/);
  assert.equal(fs.readFileSync(p, "utf-8"), text);
  const bad = tempStore();
  fs.mkdirSync(path.dirname(bad), { recursive: true });
  fs.writeFileSync(bad, "[]");
  assert.throws(() => Store.forgetProcess(bad, { id: "proc-k" }), (e) => e.code === "PROCESSES_UNREADABLE");
  assert.equal(fs.readFileSync(bad, "utf-8"), "[]");
});

test("nothing is saved without a name or without steps", () => {
  const p = tempStore();
  assert.throws(() => Store.saveProcess(p, { name: "  ", steps: STEPS }), /no name/);
  assert.throws(() => Store.saveProcess(p, { name: "X", steps: [] }), /no steps/);
  assert.throws(() => Store.saveProcess(p, { name: "X", steps: [null, 3] }), /no steps/);
  assert.equal(fs.existsSync(p), false);
});
