"use strict";
/*
 * LLM stress test (PDT-1.0-SPEC §3.2, "hallucination guard").
 *
 * 1. Thin-input refusal: synthetic cluster with no domain context — the
 *    naming layer should refuse (INSUFFICIENT_SIGNAL).
 * 2. Stability: run the same clean cluster 5 times — names should be
 *    stable (or vary in trivial ways) at temperature=0.2.
 * 3. PDD prose grounding: read the regenerated PDDs and assert the prose
 *    no longer contains hallucination markers ('executive readers',
 *    'crucial process for', 'professional relationships', etc.).
 */

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const PY = path.join(REPO, "viewer", "python", "python.exe");
const PYFALLBACK = "python";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}

function runPy(code) {
  const env = Object.assign({}, process.env, {
    PDT_OLLAMA_URL: "http://127.0.0.1:11434",
    PDT_OLLAMA_MODEL: "qwen2.5:1.5b-instruct",
    PYTHONIOENCODING: "utf-8",
  });
  const py = fs.existsSync(PY) ? PY : PYFALLBACK;
  const r = spawnSync(py, ["-c", code], { encoding: "utf-8", env, cwd: REPO });
  if (r.status !== 0) return { error: r.stderr, stdout: r.stdout };
  return { stdout: r.stdout };
}

// Test 1: thin input refusal.
{
  const res = runPy(`
import sys, json
sys.path.insert(0, 'normalization')
from naming.llm_client import OllamaBackend, LlmRequest

backend = OllamaBackend()
# Empty cluster: no process_label, no screen, no interaction types — the
# naming layer should refuse rather than fabricate.
req = LlmRequest(purpose='activity_name', derived_input={
    'process_label': '',
    'screen_label': '',
    'app': '',
    'interaction_types': [],
    'vocab_names': [],
})
r = backend.complete(req)
print(json.dumps({
    'text': r.text,
    'insufficient': r.insufficient_signal,
}))
`);
  if (res.error) {
    record("thin-input activity_name probe", false, res.error.slice(0, 200));
  } else {
    try {
      const out = JSON.parse(res.stdout.trim().split(/\r?\n/).pop());
      record("activity_name refuses on empty cluster",
        out.insufficient === true, JSON.stringify(out));
    } catch (e) { record("thin-input activity_name probe", false, "parse: " + e.message); }
  }
}

// Test 2: stability — same input 5 times.
{
  const res = runPy(`
import sys, json
sys.path.insert(0, 'normalization')
from naming.llm_client import OllamaBackend, LlmRequest

backend = OllamaBackend()
input_d = {
    'process_label': 'Incident: Save record',
    'screen_label': 'incident',
    'app': 'chrome',
    'interaction_types': ['button_press', 'value_change'],
    'vocab_names': ['Save'],
}
results = []
for _ in range(5):
    r = backend.complete(LlmRequest(purpose='activity_name', derived_input=input_d))
    results.append(r.text)
print(json.dumps({'results': results}))
`);
  if (res.error) {
    record("activity_name stability x5", false, res.error.slice(0, 200));
  } else {
    try {
      const out = JSON.parse(res.stdout.trim().split(/\r?\n/).pop());
      const distinct = new Set(out.results);
      record("activity_name stability across 5 runs",
        distinct.size <= 3,
        "distinct=" + distinct.size + " values: " + JSON.stringify(out.results));
    } catch (e) { record("activity_name stability probe", false, "parse: " + e.message); }
  }
}

// Test 3: PDD prose grounding — no hallucination markers in the prose.
const PDD_DIR = path.join(REPO, "sessions", "demo-pack", "deliverables", "pdds");
const HALLUC_MARKERS = [
  "executive reader",
  "executive readers",
  "executive's workflow",
  "stakeholder",
  "professional relationships",
  "crucial process for",
  "essential process for",
  "ensures that",
  "maintains data",
  "productivity",
  "strategic tasks",
];
if (fs.existsSync(PDD_DIR)) {
  const mdFiles = fs.readdirSync(PDD_DIR).filter(f => f.endsWith(".md"));
  record("PDD markdown files exist", mdFiles.length >= 4, "found=" + mdFiles.length);
  let totalHits = 0;
  const perFile = {};
  for (const f of mdFiles) {
    const content = fs.readFileSync(path.join(PDD_DIR, f), "utf-8");
    // Just §1 — the prose section — to avoid false positives in templated parts.
    const m = content.match(/## 1\. Process at a glance\s+([\s\S]*?)(?:##|$)/);
    const proseSection = m ? m[1] : content;
    const hits = HALLUC_MARKERS.filter(h =>
      proseSection.toLowerCase().includes(h.toLowerCase()));
    perFile[f] = hits;
    totalHits += hits.length;
  }
  record("PDD §1 prose has no hallucination markers",
    totalHits === 0,
    "hits per file: " + JSON.stringify(perFile));
} else {
  record("PDD markdown files exist", false, "dir missing");
}

const fail = results.filter(r => !r.ok).length;
console.log(`\n[llm-stress] ${results.length - fail}/${results.length} passed, ${fail} failed`);
if (fail) for (const r of results) if (!r.ok) console.log("  - " + r.name + ": " + (r.detail || ""));
process.exit(fail ? 1 : 0);
