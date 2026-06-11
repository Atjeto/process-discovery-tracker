/*
 * llm-export.js -- the "Copy for LLM" export + suggestions import
 * (lab-phase spec §C3; authoring-time, consultant-side only).
 *
 * Produces ONE human-readable JSON object from the DERIVED stream only:
 * vocab skeleton rows (signatures + auto-semantics + value-free window
 * titles), the fact strip, the findings (scrubbed), and the step groups.
 * The export is the reviewable-egress artifact -- a security officer must
 * be able to read it line by line -- so the builder enforces, by
 * construction, that:
 *
 *   - NO raw events.jsonl content is read (inputs are analysis.json
 *     blocks, annotation steps, vocab YAML rows);
 *   - NO screenshots / screenshot paths survive (stripped from every
 *     finding's evidence);
 *   - NO opaque id lists (event_ids / step_ids) survive -- numbers and
 *     labels only;
 *   - typed VALUES are tokenized: the rekey finding's example values
 *     become join-preserving "value-1"-style tokens, in the evidence AND
 *     inside the claim sentence;
 *   - window titles / step-group labels pass through the shared
 *     value-free screen strip (process-map-levels.screenType), so an
 *     embedded record number never rides along.
 *
 * The import half parses the suggestions JSON an LLM returns
 * ({ suggestions: { "<row_key>": { name?, object?, means? } } }) and
 * applies ONLY analyst-approved rows (suggest-don't-mutate: per-row or
 * select-all approval in the caller's checklist, then a normal dirty
 * save).
 *
 * Pure logic (buildLlmExport / scrubFinding / parseSuggestions /
 * applySuggestionsToVocab / vocabRowKey) is exported for node:test; no
 * DOM access at module scope. The product runtime stays no-LLM: this
 * file writes to the clipboard or a local file, never the network.
 */

"use strict";

const { screenType } = require("./process-map-levels.js");
const { vocabSignatureKey } = require("./canonical-author.js");

const EXPORT_VERSION = 1;

/* The semantic columns a vocab row carries (mirror app_vocab.SEMANTIC_FIELDS). */
const SEMANTIC_FIELDS = ["verb", "object", "completion", "case_id_source", "carries_value", "means"];

/* Suggestion fields the import will accept per row -- the human/LLM half
   only. Signatures, flags and auto-semantics are NOT importable. */
const IMPORTABLE_FIELDS = ["name", "object", "means"];

/* ---- masking helpers ---------------------------------------------------- */

/** Value-free string: the shared screen strip (record ids, order numbers). */
function maskLabel(s) {
  return screenType(String(s == null ? "" : s));
}

/** Stable row key for one vocab interaction (the import join key). */
function vocabRowKey(entry) {
  return vocabSignatureKey((entry || {}).signature || {});
}

/* ---- findings scrub ------------------------------------------------------ */

/** One finding, made safe for egress: claims + numbers survive; screenshot
 *  refs, id lists and raw typed values do not. Tokenization is
 *  join-preserving WITHIN the export (same value -> same token) via the
 *  shared `tokens` map the caller threads through. */
function scrubFinding(f, tokens) {
  const out = {
    id: String((f || {}).id || ""),
    detector: String((f || {}).detector || ""),
    claim: String((f || {}).claim || ""),
    tier: (f || {}).tier || 1,
    confidence_note: String((f || {}).confidence_note || ""),
  };
  const ev = (f || {}).evidence || {};
  const safe = {};
  for (const [k, v] of Object.entries(ev)) {
    if (k === "screenshot_refs" || k === "event_ids" || k === "step_ids") continue;
    if (typeof v === "number" || typeof v === "boolean") { safe[k] = v; continue; }
    if (typeof v === "string") {
      // Labels get the value-free strip; ISO timestamps are measured data
      // and would only be mangled by it (the 3+-digit-run rule eats years).
      safe[k] = k.endsWith("_ts") ? v : maskLabel(v);
      continue;
    }
    if (k === "values" && Array.isArray(v)) {
      // The rekey evidence rows: tokenize each raw typed value.
      safe[k] = v.map((row) => {
        const tok = _token(tokens, (row || {}).value);
        return {
          value_token: tok,
          apps: ((row || {}).apps || []).map(String),
          entry_count: (row || {}).entry_count || 0,
          fields: ((row || {}).fields || []).map(maskLabel),
        };
      });
      continue;
    }
    if (k === "top_apps" && Array.isArray(v)) {
      safe[k] = v.map((a) => ({ app: String((a || {}).app || ""), ms: (a || {}).ms || 0, share: (a || {}).share || 0 }));
      continue;
    }
    if (k === "flagged_apps" && Array.isArray(v)) {
      safe[k] = v.map((a) => ({ app: String((a || {}).app || ""), trust: String((a || {}).trust || ""), why: String((a || {}).why || "") }));
      continue;
    }
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      safe[k] = v.map(maskLabel);
      continue;
    }
    // Anything else (nested objects we don't recognize) is dropped, not
    // smuggled -- the export only carries shapes this scrubber understands.
  }
  // Replace each tokenized raw value INSIDE the claim sentence too. The
  // claim is otherwise kept verbatim: it is a templated sentence of
  // measured numbers + derived labels, and the value-free screen strip is
  // a TITLE scrubber — run over prose it eats digit runs ("(168.4/h)" ->
  // "(.4/h)") and truncates at quoted labels. Raw typed values reach a
  // claim only via the rekey detector, which the tokens map covers.
  let claim = out.claim;
  for (const [raw, tok] of tokens.entries()) {
    if (raw) claim = claim.split('"' + raw + '"').join('"' + tok + '"');
  }
  out.claim = claim;
  out.evidence = safe;
  return out;
}

function _token(tokens, raw) {
  const key = String(raw == null ? "" : raw);
  if (!tokens.has(key)) tokens.set(key, "value-" + (tokens.size + 1));
  return tokens.get(key);
}

/* ---- vocab skeleton ------------------------------------------------------ */

/** One vocab as skeleton rows: signature + auto-semantics + screen/window
 *  context. `signature.name`/window regexes are authored identity, kept
 *  verbatim except titles, which are value-free-stripped. */
function vocabSkeleton(vocab) {
  const v = vocab || {};
  const screens = (v.screens || []).map((s) => ({
    id: (s || {}).id || "",
    name: maskLabel((s || {}).name || ""),
    window_title_regex: (s || {}).window_title_regex || undefined,
  }));
  const rows = (v.interactions || []).map((e) => {
    const row = {
      row_key: vocabRowKey(e),
      signature: e.signature || {},
      name: e.name || "",
    };
    for (const k of SEMANTIC_FIELDS) {
      if (e[k] !== undefined && e[k] !== null && e[k] !== "") row[k] = e[k];
    }
    if (e.screen) row.screen = e.screen;
    if (typeof e.seen_count === "number") row.seen_count = e.seen_count;
    return row;
  });
  return {
    vocab_id: v.id || "",
    name: v.name || "",
    scope: v.scope || {},
    screens,
    rows,
  };
}

/* ---- step groups --------------------------------------------------------- */

/** Roll the annotation steps up to value-free process-label groups --
 *  label, instance count, total duration, dominant app. No per-instance
 *  rows, no values, no ids. */
function stepGroups(steps) {
  const groups = new Map();
  for (const s of steps || []) {
    if (!s || s.state === "hidden") continue;
    const label = maskLabel(s.process_label || s.name || "");
    if (!label) continue;
    let g = groups.get(label);
    if (!g) { g = { label, instances: 0, total_ms: 0, apps: new Map() }; groups.set(label, g); }
    g.instances += 1;
    const tr = s.time_range || {};
    const a = tr.start ? new Date(tr.start).getTime() : NaN;
    const b = tr.end ? new Date(tr.end).getTime() : NaN;
    if (isFinite(a) && isFinite(b) && b >= a) g.total_ms += (b - a);
    const app = ((s.grain_keys || {}).app || "").trim();
    if (app) g.apps.set(app, (g.apps.get(app) || 0) + 1);
  }
  return Array.from(groups.values())
    .sort((x, y) => y.total_ms - x.total_ms || y.instances - x.instances)
    .map((g) => {
      let top = "", n = 0;
      for (const [app, c] of g.apps.entries()) if (c > n) { top = app; n = c; }
      return {
        label: g.label,
        instances: g.instances,
        total_ms: Math.round(g.total_ms),
        app: top || undefined,
      };
    });
}

/* ---- the one export object ----------------------------------------------- */

/**
 * Build the Copy-for-LLM document. Everything is optional: the App Library
 * surface passes vocabs only; the Overview passes the session too.
 *
 * @param {object} opts
 *   {Array}  opts.vocabs   -- vocab dicts (the YAML app_vocabulary objects)
 *   {object} opts.session  -- { analysis, annotations } (derived artifacts)
 *   {string} opts.posture  -- the current data posture (recorded in-band)
 *   {string} opts.surface  -- "app-library" | "overview" (provenance)
 */
function buildLlmExport(opts) {
  const o = opts || {};
  const doc = {
    pdt_copy_for_llm: {
      version: EXPORT_VERSION,
      surface: o.surface || "",
      data_posture: o.posture || "",
      contents: "Derived, PII-masked working data from a process-discovery " +
        "session: vocabulary skeleton rows (UI control signatures + " +
        "auto-derived semantics), measured facts, findings, and step groups. " +
        "No raw event stream, no screenshots, no typed values (re-keyed " +
        "values appear as join-preserving tokens like \"value-1\").",
      how_to_respond: {
        instructions: "Suggest better human-readable values for the vocabulary " +
          "rows: a concise `name` (what an analyst would call the control), " +
          "an `object` (the business object it acts on, e.g. \"customer " +
          "record\"), and a `means` line (what using it means in the " +
          "process). Respond with ONE JSON object in exactly this shape; " +
          "key every suggestion by the row's `row_key`. Only suggest fields " +
          "you are confident about; omit rows you cannot improve. The " +
          "analyst reviews every suggestion before anything is applied.",
        response_shape: {
          suggestions: {
            "<row_key>": { name: "…", object: "…", means: "…" },
          },
        },
      },
    },
  };
  const root = doc.pdt_copy_for_llm;
  if (Array.isArray(o.vocabs) && o.vocabs.length) {
    root.vocabularies = o.vocabs.map(vocabSkeleton);
  }
  const sess = o.session || null;
  if (sess) {
    const analysis = sess.analysis || {};
    const tokens = new Map();
    const section = {};
    const cq = analysis.case_quality;
    if (cq) {
      section.case_quality = {
        mode: cq.mode, case_count: cq.case_count,
        coverage: cq.coverage, tier2_unlocked: cq.tier2_unlocked,
      };
    }
    if (analysis.facts) {
      const f = analysis.facts;
      section.facts = {
        active_ms: f.active_ms, idle_ms: f.idle_ms,
        session_span_ms: f.session_span_ms,
        top_apps: (f.top_apps || []).map((a) => ({ app: a.app, ms: a.ms, share: a.share })),
        app_switches: f.app_switches, switches_per_hour: f.switches_per_hour,
        longest_focus_ms: f.longest_focus_ms,
        rekey_count: f.rekey_count,
        repeated_sequence_count: f.repeated_sequence_count,
      };
    }
    if (Array.isArray(analysis.findings)) {
      section.findings = analysis.findings.map((f) => scrubFinding(f, tokens));
    }
    const steps = ((sess.annotations || {}).steps) || [];
    section.step_groups = stepGroups(steps);
    root.session = section;
  }
  return doc;
}

/** Render the export as the human-readable JSON text (the artifact). */
function exportText(opts) {
  return JSON.stringify(buildLlmExport(opts), null, 2);
}

/* ---- import: parse + apply (suggest-don't-mutate) ------------------------- */

/**
 * Parse a pasted/loaded suggestions document. Accepts either the bare
 * { "<row_key>": {...} } map or the { suggestions: {...} } wrapper the
 * export asks for. Returns { suggestions, error } where suggestions is a
 * clean map row_key -> { name?, object?, means? } (strings, trimmed,
 * unknown fields dropped).
 */
function parseSuggestions(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || ""));
  } catch (e) {
    return { suggestions: null, error: "Not valid JSON: " + e.message };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { suggestions: null, error: "Expected a JSON object." };
  }
  const map = (raw.suggestions && typeof raw.suggestions === "object" && !Array.isArray(raw.suggestions))
    ? raw.suggestions : raw;
  const out = {};
  let rows = 0;
  for (const [key, val] of Object.entries(map)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const clean = {};
    for (const f of IMPORTABLE_FIELDS) {
      if (typeof val[f] === "string" && val[f].trim()) clean[f] = val[f].trim();
    }
    if (Object.keys(clean).length) { out[key] = clean; rows += 1; }
  }
  if (!rows) return { suggestions: null, error: "No usable suggestions found (expected { suggestions: { \"<row_key>\": { name/object/means } } })." };
  return { suggestions: out, error: null };
}

/**
 * Match suggestions against a vocab's rows. Returns
 * [{ key, entryIndex, current, proposed }] for rows that exist AND would
 * change; unknown row_keys are returned in `unmatched`.
 */
function matchSuggestions(vocab, suggestions) {
  const entries = ((vocab || {}).interactions) || [];
  const byKey = new Map();
  entries.forEach((e, i) => {
    const k = vocabRowKey(e);
    if (k && !byKey.has(k)) byKey.set(k, i);
  });
  const rows = [];
  const unmatched = [];
  for (const [key, proposed] of Object.entries(suggestions || {})) {
    const idx = byKey.get(key);
    if (idx === undefined) { unmatched.push(key); continue; }
    const e = entries[idx];
    const delta = {};
    for (const f of IMPORTABLE_FIELDS) {
      if (proposed[f] && proposed[f] !== (e[f] || "")) delta[f] = proposed[f];
    }
    if (Object.keys(delta).length) {
      rows.push({ key, entryIndex: idx, current: { name: e.name || "", object: e.object || "", means: e.means || "" }, proposed: delta });
    }
  }
  return { rows, unmatched };
}

/**
 * Apply ONLY the approved row keys onto a vocab (in place; the caller owns
 * dirty-marking and the eventual explicit Save). Returns the applied count.
 */
function applySuggestionsToVocab(vocab, matchedRows, approvedKeys) {
  const approved = new Set(approvedKeys || []);
  let applied = 0;
  for (const row of matchedRows || []) {
    if (!approved.has(row.key)) continue;
    const e = ((vocab || {}).interactions || [])[row.entryIndex];
    if (!e) continue;
    for (const [f, v] of Object.entries(row.proposed)) e[f] = v;
    applied += 1;
  }
  return applied;
}

/* ---- the review modal (shared by App Library + Overview) ------------------ */

/** Show the export for line-by-line review with Copy / Save actions.
 *  DOM-only; never called in node tests. */
function showExportModal(opts) {
  const { clipboard } = require("electron");
  const Ipc = require("./ipc.js");
  const { toast } = require("./dom.js");
  const text = exportText(opts);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal llm-export-modal">' +
    '<header class="modal-header"><h2>Copy for AI review — check it before it leaves</h2>' +
    '<button class="icon-btn modal-close" title="Close (Esc)">✕</button></header>' +
    '<div class="modal-body">' +
    '<p class="modal-msg">A privacy-masked summary only — app entries, key numbers, findings, step groups. ' +
    'No raw events, no screenshots, no typed values (placeholders stand in for them). ' +
    'Read it line by line; this app sends nothing anywhere — <em>you</em> paste it.</p>' +
    '<textarea class="llm-export-text" readonly spellcheck="false"></textarea>' +
    "</div>" +
    '<footer class="modal-footer">' +
    '<span class="meta llm-export-size"></span>' +
    '<span class="flex-spacer"></span>' +
    '<button class="modal-cancel">Close</button>' +
    '<button class="llm-export-save">Save to file…</button>' +
    '<button class="primary llm-export-copy">Copy to clipboard</button>' +
    "</footer></div>";
  document.body.appendChild(backdrop);
  backdrop.querySelector(".llm-export-text").value = text;
  backdrop.querySelector(".llm-export-size").textContent =
    text.split("\n").length + " lines · " + (text.length / 1024).toFixed(1) + " KB";
  function close() { backdrop.remove(); document.removeEventListener("keydown", onKey, true); }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  document.addEventListener("keydown", onKey, true);
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".llm-export-copy").addEventListener("click", () => {
    clipboard.writeText(text);
    toast("Copied — paste it into your AI chat yourself (data sharing mode: " + (opts.posture || "?") + ")", "success");
  });
  backdrop.querySelector(".llm-export-save").addEventListener("click", async () => {
    const r = await Ipc.saveTextFile({
      content: text,
      suggestedName: "copy-for-llm-" + (opts.surface || "export") + ".json",
      title: "Save Copy-for-LLM export",
      filterName: "JSON document", filterExt: "json",
    });
    if (r && r.ok) toast("Saved " + r.path, "success");
  });
  return backdrop;
}

module.exports = {
  EXPORT_VERSION, SEMANTIC_FIELDS, IMPORTABLE_FIELDS,
  maskLabel, vocabRowKey, scrubFinding, vocabSkeleton, stepGroups,
  buildLlmExport, exportText,
  parseSuggestions, matchSuggestions, applySuggestionsToVocab,
  showExportModal,
};
