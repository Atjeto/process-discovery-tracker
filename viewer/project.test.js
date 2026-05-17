/*
 * Unit tests for project.js -- the Phase F additions: portable
 * relative paths and the carry-forward of project-level config.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Project = require("./project.js");

test("newProjectShape carries the Phase F config fields", () => {
  const s = Project.newProjectShape("P");
  assert.equal(s.findings, "");
  assert.deepEqual(s.default_ignored_processes, []);
  assert.equal(s.step_template_session, null);
});

test("validateProject backfills the new fields on an older project file", () => {
  const v = Project.validateProject({ format: "pdt-project", version: 1, name: "Old" });
  assert.ok(v.ok);
  assert.equal(v.project.findings, "");
  assert.deepEqual(v.project.default_ignored_processes, []);
  assert.equal(v.project.step_template_session, null);
});

test("toRelativePaths makes session/template paths relative to the project dir", () => {
  const dir = path.resolve("work", "proj");
  const project = {
    currentSessionFolder: path.resolve("work", "sessions", "s1"),
    templatePath: path.resolve("work", "proj", "t.yaml"),
    aggregateSessions: [path.resolve("work", "sessions", "s1")],
    step_template_session: path.resolve("work", "sessions", "tmpl"),
  };
  const rel = Project.toRelativePaths(project, dir);
  assert.ok(!path.isAbsolute(rel.currentSessionFolder));
  assert.ok(!path.isAbsolute(rel.aggregateSessions[0]));
  assert.ok(!path.isAbsolute(rel.step_template_session));
  assert.equal(rel.templatePath, "t.yaml");
});

test("toAbsolutePaths is the inverse of toRelativePaths", () => {
  const dir = path.resolve("work", "proj");
  const project = {
    currentSessionFolder: path.resolve("work", "sessions", "s1"),
    templatePath: null,
    aggregateSessions: [path.resolve("work", "sessions", "s2")],
    step_template_session: null,
  };
  const round = Project.toAbsolutePaths(Project.toRelativePaths(project, dir), dir);
  assert.equal(round.currentSessionFolder, project.currentSessionFolder);
  assert.equal(round.aggregateSessions[0], project.aggregateSessions[0]);
});

test("toAbsolutePaths leaves a legacy absolute path untouched", () => {
  const dir = path.resolve("work", "proj");
  const abs = path.resolve("elsewhere", "s9");
  const round = Project.toAbsolutePaths({ currentSessionFolder: abs }, dir);
  assert.equal(round.currentSessionFolder, abs);
});

test("captureFromCollectors carries project config forward across a save", () => {
  Project.setActiveProject({
    path: "p", name: "P", findings: "key risk: SAP latency",
    default_ignored_processes: ["obs.exe"], step_template_session: "tmpl",
  });
  const snap = Project.captureFromCollectors({}, {});
  assert.equal(snap.findings, "key risk: SAP latency");
  assert.deepEqual(snap.default_ignored_processes, ["obs.exe"]);
  assert.equal(snap.step_template_session, "tmpl");
  Project.setActiveProject(null);
});
