"use strict";

/* demo-project.js: the demo that ships with the app is found in the package
   or the dev tree, and each Open the demo project gets a fresh copy. */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Demo = require("./demo-project.js");

test("the dev tree's demo is found, and a package's resources/demo comes first", () => {
  const dev = Demo.demoSource(null, __dirname);
  assert.equal(dev, path.join(__dirname, "..", "demo", Demo.DEMO_NAME));
  const res = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-demo-res-"));
  try {
    fs.mkdirSync(path.join(res, "demo", Demo.DEMO_NAME), { recursive: true });
    fs.writeFileSync(path.join(res, "demo", Demo.DEMO_NAME, "manifest.json"), "{}");
    assert.equal(Demo.demoSource(res, __dirname), path.join(res, "demo", Demo.DEMO_NAME));
    assert.equal(Demo.demoSource(path.join(res, "nowhere"), path.join(res, "a", "b")), null);
  } finally { fs.rmSync(res, { recursive: true, force: true }); }
});

test("each copy of the demo gets a folder of its own: Order to cash, then (2), (3)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-demo-copies-"));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-demo-src-"));
  try {
    const demo = path.join(src, Demo.DEMO_NAME);
    fs.mkdirSync(path.join(demo, "screenshots"), { recursive: true });
    fs.writeFileSync(path.join(demo, "manifest.json"), "{}");
    fs.writeFileSync(path.join(demo, "screenshots", "a.jpg"), "x");
    const one = Demo.copyDemo(demo, path.join(root, "PDT demo"));
    const two = Demo.copyDemo(demo, path.join(root, "PDT demo"));
    const three = Demo.copyDemo(demo, path.join(root, "PDT demo"));
    assert.deepEqual([one, two, three].map((p) => path.basename(p)),
      ["Order to cash", "Order to cash (2)", "Order to cash (3)"]);
    assert.ok(fs.existsSync(path.join(three, "screenshots", "a.jpg")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});
