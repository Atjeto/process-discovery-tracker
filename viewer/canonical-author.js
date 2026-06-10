/*
 * canonical-author.js -- helpers for *authoring* Process Templates
 * (canonical processes), as opposed to template-view.js which renders
 * and edits one.
 *
 * Pure functions only (no DOM, no Electron) so the module is unit-
 * testable under node:test and shareable between the Steps view and
 * the Process Template tab. Callers serialize the returned objects to
 * YAML themselves.
 *
 * The canonical YAML shape is defined by
 * normalization/canonical_match.py -- every step needs a `step_id`, and
 * a match rule is { process_name?, window_title_regex?, interaction? }.
 */

"use strict";

const crypto = require("crypto");

/** Lowercase + hyphenate a name into an id -- mirrors the App Library
 *  "+ New vocabulary" id rule (vocab-view.js). */
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* JS port of normalization/canonical_match.py::_interaction_matches.
   Keep the two in sync -- a rule that fires here must fire in Python.
   Used for the live "does the open template already match this?"
   preview on the Process Template tab. */
function interactionMatches(rule, ev) {
  if (!rule || !ev) return false;
  const data = ev.data || {};
  if (rule.process_name && data.process_name !== rule.process_name) return false;
  if (rule.window_title_regex) {
    let re;
    try { re = new RegExp(rule.window_title_regex); }
    catch (_) { return false; }
    if (!re.test(data.window_title || "")) return false;
  }
  if (rule.interaction) {
    for (const k of ["control_type", "automation_id", "name"]) {
      if (k in rule.interaction && data[k] !== rule.interaction[k]) return false;
    }
  }
  return true;
}

/** Longest substring present in every string. Used to generalize a set
 *  of window titles into one regex. O(n*m^2) -- fine for short titles. */
function longestCommonSubstring(strings) {
  const list = (strings || []).filter((s) => typeof s === "string" && s.length);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  let shortest = list[0];
  for (const s of list) if (s.length < shortest.length) shortest = s;
  let best = "";
  for (let i = 0; i < shortest.length; i++) {
    for (let j = i + best.length + 1; j <= shortest.length; j++) {
      const sub = shortest.slice(i, j);
      if (list.every((s) => s.includes(sub))) {
        if (sub.length > best.length) best = sub;
      } else {
        break;
      }
    }
  }
  return best;
}

/* Derive a *first-draft* match rule from a set of real interaction
   events. The analyst tunes it afterwards -- the goal is a working
   starting point, not a perfect rule. Returns null when the
   interactions share nothing worth matching on. */
function deriveMatchRule(interactions) {
  const ints = (interactions || []).filter(Boolean);
  if (!ints.length) return null;
  const datas = ints.map((e) => e.data || {});
  const rule = {};

  // process_name: only when every interaction agrees on a non-empty value.
  const procs = new Set(datas.map((d) => d.process_name).filter(Boolean));
  if (procs.size === 1 && datas.every((d) => d.process_name)) {
    rule.process_name = [...procs][0];
  }

  // window_title_regex: longest substring common to every title, kept
  // only when it's distinctive enough (>= 4 chars) to be worth matching.
  const titles = datas.map((d) => d.window_title || "");
  if (titles.every((t) => t)) {
    const common = longestCommonSubstring(titles).trim();
    if (common.length >= 4) {
      rule.window_title_regex = ".*" + escapeRegex(common) + ".*";
    }
  }

  // interaction: control_type / automation_id when consistent + non-empty.
  // `name` is intentionally skipped -- it's too volatile to match on.
  const interaction = {};
  for (const k of ["control_type", "automation_id"]) {
    const vals = new Set(datas.map((d) => d[k]).filter(Boolean));
    if (vals.size === 1 && datas.every((d) => d[k])) interaction[k] = [...vals][0];
  }
  if (Object.keys(interaction).length) rule.interaction = interaction;

  return Object.keys(rule).length ? rule : null;
}

/* Convert a session's annotated steps into canonical template steps.
   `steps` are annotation steps (steps-view.js makeStep shape); `events`
   is the session's full event list. Each template step carries the
   name + description over and a match rule derived from the
   interactions the step cites in evidence.interaction_event_ids. When
   `vocabs` is supplied, a derived rule that corresponds to a known App
   Library interaction is auto-linked (gets a library_ref). */
function stepsToTemplateSteps(steps, events, vocabs) {
  const byId = new Map();
  for (const ev of events || []) {
    if (ev && ev.type === "interaction" && ev.event_id) byId.set(ev.event_id, ev);
  }
  return (steps || []).map((s) => {
    const ids = (s.evidence && s.evidence.interaction_event_ids) || [];
    const ints = ids.map((id) => byId.get(id)).filter(Boolean);
    const rule = deriveMatchRule(ints);
    if (rule && vocabs && vocabs.length) {
      const ref = recognizeRule(rule, vocabs);
      if (ref) rule.library_ref = ref;
    }
    return {
      step_id: crypto.randomUUID(),
      name: (s.name || "Untitled step").trim(),
      description: (s.description || "").trim(),
      match: rule ? [rule] : [],
    };
  });
}

/** A minimal valid canonical_process object. `steps` defaults to [].
 *  opts.caseAnchor (a clean `case_anchor` block, see anchorFromOverride)
 *  rides along so a template exported from a curated session carries the
 *  accepted anchor -- the flywheel (lab-phase §D3): the NEXT session of
 *  the same process arrives self-segmented, no per-session Accept. */
function canonicalSkeleton(name, steps, opts) {
  const proc = {
    id: slugify(name) || "untitled-process",
    name: (name || "Untitled Process").trim(),
    version: 1,
  };
  if (opts && opts.caseAnchor) proc.case_anchor = opts.caseAnchor;
  proc.steps = Array.isArray(steps) ? steps : [];
  return { canonical_process: proc };
}

/* The session's accepted anchor (annotations.case_anchor_override) as a
   clean template `case_anchor` block -- JS port of
   normalization/anchor_suggest.coerce_anchor_override. Strips the
   `_accepted_*` audit fields (they tie the override to its candidate;
   a template is session-independent) and null values; null when the
   override is absent/malformed (no `field` string and no `recognized`
   category). Keep the two in sync. */
function anchorFromOverride(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.field !== "string" && !raw.recognized) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_") || v === null || v === undefined) continue;
    out[k] = v;
  }
  if (out.case_label_from == null) out.case_label_from = "value";
  return out;
}

/* ---- Phase authoring. A canonical_process may carry a `phases` list,
   each { phase_id, name, step_ids[] }: phases own their step_ids, steps
   carry no phase_id. rollup_phases in canonical_match.py consumes this.
   The Process Template tab edits phases inline per step, so these
   helpers reconcile a single step's phase membership. ---- */

/* Return the phase_id of the phase named `name`, creating it when
   absent. A new phase_id is slugify(name), de-collided with -2/-3...
   against existing ids. Mutates proc.phases (created if missing). A
   blank name returns null and creates nothing. */
function ensurePhase(proc, name) {
  const label = String(name || "").trim();
  if (!label) return null;
  if (!Array.isArray(proc.phases)) proc.phases = [];
  const existing = proc.phases.find(
    (p) => p && String(p.name || "").trim().toLowerCase() === label.toLowerCase());
  if (existing) return existing.phase_id;
  const taken = new Set(proc.phases.map((p) => p && p.phase_id).filter(Boolean));
  const base = slugify(label) || "phase";
  let id = base, n = 2;
  while (taken.has(id)) { id = base + "-" + n; n++; }
  proc.phases.push({ phase_id: id, name: label, step_ids: [] });
  return id;
}

/* Move `stepId` so it belongs to exactly `targetPhaseId` (or to no
   phase when targetPhaseId is falsy). Removes the id from every phase,
   appends it to the target if absent, then drops any phase left with no
   steps. Mutates proc. No-op on a falsy stepId. */
function assignStepToPhase(proc, stepId, targetPhaseId) {
  if (!stepId) return;
  if (!Array.isArray(proc.phases)) proc.phases = [];
  for (const p of proc.phases) {
    if (!p) continue;
    p.step_ids = (Array.isArray(p.step_ids) ? p.step_ids : []).filter((id) => id !== stepId);
  }
  if (targetPhaseId) {
    const target = proc.phases.find((p) => p && p.phase_id === targetPhaseId);
    if (target && !target.step_ids.includes(stepId)) target.step_ids.push(stepId);
  }
  proc.phases = proc.phases.filter((p) => p && (p.step_ids || []).length > 0);
}

/* ---- App Library integration (ADR-0002 vocabularies as the rule
   substrate). A template match rule may carry an optional
   `library_ref: { vocab_id, interaction }` linking it to a named App
   Library interaction; the literal fields are cached alongside so
   normalization/canonical_match.py reads them unchanged. ---- */

/* Deterministic dedup key for a vocab interaction signature -- JS port
   of normalization/app_vocab.py::_signature_key (process_name dropped:
   a vocab is already process-scoped). Returns null when the signature
   has nothing usable. */
function vocabSignatureKey(signature) {
  const s = signature || {};
  if (s.automation_id) return "aid|" + s.automation_id;
  if (s.control_type && s.name) return "ctn|" + s.control_type + "|" + s.name;
  if (s.class_name && s.name) return "cnn|" + s.class_name + "|" + s.name;
  if (s.name) return "n|" + s.name;
  // A class_name-only signature is weak but real (ADR-0025): mirror Python's
  // _snapshot_sig_key so re-discovery dedups it instead of re-adding duplicates.
  if (s.class_name) return "cn|" + s.class_name;
  return null;
}

/* Minimum signature that identifies an interaction -- JS port of
   normalization/app_vocab.py::_signature_from_event. Accepts an event
   ({ data: {...} }) or a raw data object. */
function signatureFromInteraction(ev) {
  const d = (ev && ev.data) || ev || {};
  if (d.automation_id) {
    const sig = { automation_id: d.automation_id };
    if (d.control_type) sig.control_type = d.control_type;
    return sig;
  }
  if (d.control_type && d.name) return { control_type: d.control_type, name: d.name };
  if (d.class_name && d.name) return { class_name: d.class_name, name: d.name };
  if (d.name) return { name: d.name };
  return null;
}

/* Merge new interaction entries into a vocab, deduped by signature key.
   On a key collision the EXISTING entry is kept (it may carry an
   analyst-curated name); only genuinely-new interactions are appended.
   Returns a new vocab object plus counts -- the input is not mutated. */
function mergeInteractionsIntoVocab(vocab, newInteractions) {
  const v = vocab || {};
  const merged = Array.isArray(v.interactions) ? v.interactions.slice() : [];
  const seen = new Set();
  for (const e of merged) {
    const k = vocabSignatureKey(e && e.signature);
    if (k) seen.add(k);
  }
  let added = 0, skipped = 0;
  for (const ni of (newInteractions || [])) {
    if (!ni || !ni.signature) { skipped++; continue; }
    const k = vocabSignatureKey(ni.signature);
    if (k && seen.has(k)) { skipped++; continue; }
    merged.push(ni);
    if (k) seen.add(k);
    added++;
  }
  return { vocab: Object.assign({}, v, { interactions: merged }), added, skipped };
}

/* Remap an App Library interaction into a hybrid match rule: the
   resolved literal fields canonical_match.py reads, plus a library_ref
   back to the entry. */
function vocabInteractionToRule(vocab, entry) {
  if (!vocab || !entry) return null;
  const sig = entry.signature || {};
  const scope = vocab.scope || {};
  const rule = {};
  if (vocab.id != null && entry.name) {
    rule.library_ref = { vocab_id: vocab.id, interaction: entry.name };
  }
  if (scope.process_name) rule.process_name = scope.process_name;
  const wtr = sig.window_title_regex || scope.window_title_regex;
  if (wtr) rule.window_title_regex = wtr;
  const interaction = {};
  for (const k of ["control_type", "automation_id", "name"]) {
    if (sig[k]) interaction[k] = sig[k];
  }
  if (Object.keys(interaction).length) rule.interaction = interaction;
  return rule;
}

/* True when two rules carry the same literal match fields (library_ref
   and other metadata ignored). */
function sameRuleLiteral(a, b) {
  if (!a || !b) return false;
  if ((a.process_name || "") !== (b.process_name || "")) return false;
  if ((a.window_title_regex || "") !== (b.window_title_regex || "")) return false;
  const ai = a.interaction || {}, bi = b.interaction || {};
  for (const k of ["control_type", "automation_id", "name"]) {
    if ((ai[k] || "") !== (bi[k] || "")) return false;
  }
  return true;
}

/* Given a literal/derived rule, find the named App Library interaction
   it corresponds to (same signature key, compatible process). Returns a
   library_ref or null -- used to auto-link rules derived from sessions. */
function recognizeRule(rule, vocabs) {
  if (!rule || !rule.interaction) return null;
  const ruleSig = {};
  for (const k of ["control_type", "automation_id", "name"]) {
    if (rule.interaction[k]) ruleSig[k] = rule.interaction[k];
  }
  const ruleKey = vocabSignatureKey(ruleSig);
  if (!ruleKey) return null;
  for (const v of (vocabs || [])) {
    const scope = (v && v.scope) || {};
    if (scope.process_name && rule.process_name &&
        scope.process_name !== rule.process_name) continue;
    for (const entry of ((v && v.interactions) || [])) {
      if (!entry || !entry.name) continue;
      if (vocabSignatureKey(entry.signature) === ruleKey) {
        return { vocab_id: v.id, interaction: entry.name };
      }
    }
  }
  return null;
}

/* For a hybrid rule, true when its cached literal no longer matches the
   current App Library entry it references (the entry was edited). A
   missing vocab/entry is "unresolved", not drift -> returns false. */
function ruleDrift(rule, vocabs) {
  if (!rule || !rule.library_ref) return false;
  const ref = rule.library_ref;
  const vocab = (vocabs || []).find((v) => v && v.id === ref.vocab_id);
  if (!vocab) return false;
  const entry = (vocab.interactions || []).find((e) => e && e.name === ref.interaction);
  if (!entry) return false;
  return !sameRuleLiteral(vocabInteractionToRule(vocab, entry), rule);
}

module.exports = {
  slugify, interactionMatches, longestCommonSubstring,
  deriveMatchRule, stepsToTemplateSteps, canonicalSkeleton, anchorFromOverride,
  ensurePhase, assignStepToPhase,
  vocabSignatureKey, signatureFromInteraction, mergeInteractionsIntoVocab,
  vocabInteractionToRule, recognizeRule, ruleDrift,
};
