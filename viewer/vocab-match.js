"use strict";
/*
 * vocab-match.js — the R2 match workbench engine (viewer-side, advisory).
 *
 * Given the loaded session's RAW interaction events and one App Library
 * vocabulary, compute the three evidence lists the workbench renders:
 *   - MATCHED   : distinct captured controls a vocab entry named.
 *   - UNNAMED   : distinct captured controls no vocab entry named (the worklist).
 *   - DEAD RULES: vocab entries that matched nothing in this session.
 * Plus a coverage headline and the observed-screens split.
 *
 * WHY A SEPARATE MATCHER (mirror, not ground truth):
 *   This mirrors the matching semantics of normalization/app_vocab.py so the
 *   analyst can see, from a session folder alone (no live probing), whether a
 *   selector is right — BEFORE re-running the pipeline. It is ADVISORY: the
 *   pipeline (app_vocab.enrich_events) stays the single source of truth for the
 *   names that actually land in stats/annotations. If this and the pipeline ever
 *   disagree, the pipeline wins; a re-analyze reconciles the session.
 *
 * SEMANTICS MIRRORED FROM app_vocab.py (read-only; keep the two in sync):
 *   - _scope_matches: scope.process_name is compared case-INSENSITIVELY;
 *     scope.window_title_regex must .search() the event's window_title.
 *   - _signature_match: every non-empty field of the signature in
 *     _SIG_FIELDS = (control_type, automation_id, name, class_name,
 *     framework_id) must EQUAL the event's same field; plus an optional
 *     window_title_regex on the signature. Specificity = count of matched
 *     fields (incl. the regex). Empty signature never matches.
 *   - _best_entry / lookup: across a vocab's entries, the MOST-SPECIFIC match
 *     wins (ties → first-defined). Across vocabs the pipeline picks most-specific
 *     overall; the workbench scopes to ONE vocab at a time, so cross-vocab
 *     precedence is out of scope here (a control named by a DIFFERENT vocab still
 *     shows as UNNAMED for the vocab under inspection — that is the honest state
 *     for "is THIS vocab's selector right?").
 *
 * DRIFT RISK (documented, not mirrored):
 *   - The pipeline also tags a value-free screen_id on in-scope but unnamed
 *     interactions (_screen_by_window, ADR-0024 §6b). That does NOT count toward
 *     coverage there either, so it does not change MATCHED/UNNAMED here.
 *   - The pipeline's ReDoS guard (regex_guard) rejects catastrophic-backtracking
 *     patterns, treating them as non-matching. Here a bad/uncompilable regex is
 *     likewise treated as non-matching (try/catch), but a ReDoS-prone-yet-valid
 *     pattern is NOT rejected — a pathological authored regex could match here
 *     while the pipeline drops it. Authored vocabs in practice don't carry these;
 *     flagged for honesty.
 *   - framework_id participates in signature specificity but the shipped/discovered
 *     signatures almost never set it; parity holds because the field is compared
 *     identically.
 *
 * Pure module: no DOM, no IPC. Unit-tested in vocab-match.test.js.
 */

// Signature fields, in the SAME set app_vocab.py::_SIG_FIELDS uses.
const SIG_FIELDS = ["control_type", "automation_id", "name", "class_name", "framework_id"];

// The UIA control types a person actually interacts with — the default triage
// keep-set for a "Discover from window" snapshot (R1 App Library pass). A live
// snapshot of a real app returns ~100+ controls, most of them decorative Text /
// structural Pane/Group; naming those is noise. This is the interactive subset
// the recorder emits as `control_type` (the standard UIA localized control-type
// names). Non-interactive controls are hidden behind an explicit "show more"
// row, never dropped. (Matches app_vocab's verb/value control-role tables.)
const INTERACTIVE_CONTROL_TYPES = new Set([
  "Button", "Edit", "ComboBox", "CheckBox", "RadioButton", "MenuItem",
  "ListItem", "TreeItem", "TabItem", "SplitButton", "Hyperlink", "DataItem",
]);

function _isInteractive(controlType) {
  return INTERACTIVE_CONTROL_TYPES.has(String(controlType || "").trim());
}

/* Does a candidate have a stable (non-volatile) identity to key a rule on?
   name or a non-volatile automation_id = stable; a volatile automation_id or a
   class_name-only / empty identity = not. Drives the triage RANK (stable ids
   sort first). */
function _hasStableIdentity(sig) {
  sig = _asData(sig);
  if (sig.name) return true;
  if (sig.automation_id && !looksVolatileId(sig.automation_id)) return true;
  return false;
}

/* Triage a raw snapshot control set BEFORE it renders as candidates (R1 App
   Library pass — "discovery produces candidates, not entries; naming is the
   review"). A live probe returns ~100 mostly-decorative controls; showing all
   of them as a worklist is the exact defect the owner reported. So:
     - keep interactive control types only (Button/Edit/ComboBox/… — the set
       above); everything else is deferred, not dropped;
     - rank the kept set by has-stable-identity, then interactive-ness, then
       occurrence (seen_count desc), so the nameable, high-traffic controls
       lead;
     - hard-cap the default render (`cap`, default 40); the overflow (the rest
       of the interactive set past the cap PLUS every deferred non-interactive
       control) is returned separately so the view offers "show N more incl.
       non-interactive". NOTHING is preselected — these are candidates.

   `controls` are candidate-shaped objects carrying at least a `signature`
   (with control_type) and optionally `seenCount`. Returns
   { shown, deferred, keptTotal, rawTotal } where shown.length <= cap. Pure. */
function triageSnapshotCandidates(controls, cap) {
  const list = Array.isArray(controls) ? controls.slice() : [];
  const rawTotal = list.length;
  const limit = typeof cap === "number" && cap > 0 ? cap : 40;

  const interactive = [];
  const nonInteractive = [];
  for (const c of list) {
    const ct = (_asData(c).signature || {}).control_type;
    if (_isInteractive(ct)) interactive.push(c); else nonInteractive.push(c);
  }

  // Rank the interactive set: stable identity first, then occurrence.
  const rank = (a, b) => {
    const sa = _hasStableIdentity((_asData(a).signature) || {}) ? 1 : 0;
    const sb = _hasStableIdentity((_asData(b).signature) || {}) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const ca = typeof a.seenCount === "number" ? a.seenCount : 0;
    const cb = typeof b.seenCount === "number" ? b.seenCount : 0;
    return cb - ca;
  };
  interactive.sort(rank);
  nonInteractive.sort(rank);

  const shown = interactive.slice(0, limit);
  // Overflow = interactive past the cap, then ALL non-interactive (labeled as
  // such by the view's "incl. non-interactive" copy).
  const deferred = interactive.slice(limit).concat(nonInteractive);
  return { shown, deferred, keptTotal: interactive.length, rawTotal };
}

function _asData(x) {
  return x && typeof x === "object" ? x : {};
}

function _compile(pattern) {
  // Mirror app_vocab._compile_regex's failure mode: an invalid pattern is
  // treated as non-matching (returns null) rather than throwing. (See DRIFT
  // RISK above re: ReDoS-prone-but-valid patterns, which we do NOT reject.)
  if (typeof pattern !== "string" || !pattern) return null;
  try { return new RegExp(pattern); } catch (_) { return null; }
}

/* scope.process_name (case-insensitive) + scope.window_title_regex (.search).
   Empty scope matches everything. Mirror of _scope_matches. */
function scopeMatches(vocab, data) {
  const scope = _asData((_asData(vocab)).scope);
  data = _asData(data);
  const pn = scope.process_name;
  if (pn) {
    const evPn = data.process_name;
    if (typeof evPn !== "string" || evPn.toLowerCase() !== String(pn).toLowerCase()) {
      return false;
    }
  }
  const wtr = scope.window_title_regex;
  if (wtr) {
    const r = _compile(wtr);
    if (!r || !r.test(String(data.window_title || ""))) return false;
  }
  return true;
}

/* Returns { ok, specificity }. Every non-empty signature field must equal the
   event's; specificity is the count of participating fields (incl. an optional
   window_title_regex). Mirror of _signature_match. */
function signatureMatch(sig, data) {
  sig = _asData(sig);
  data = _asData(data);
  const keys = Object.keys(sig);
  if (!keys.length) return { ok: false, specificity: 0 };
  let specificity = 0;
  for (const f of SIG_FIELDS) {
    const want = sig[f];
    if (want === undefined || want === null || want === "") continue;
    if (data[f] !== want) return { ok: false, specificity: 0 };
    specificity += 1;
  }
  const wtr = sig.window_title_regex;
  if (wtr) {
    const r = _compile(wtr);
    if (!r || !r.test(String(data.window_title || ""))) return { ok: false, specificity: 0 };
    specificity += 1;
  }
  return { ok: specificity > 0, specificity };
}

/* The most-specific matching entry for one event, within one vocab (scope
   already checked by the caller). Ties → first-defined. Mirror of _best_entry +
   the single-vocab slice of lookup. Returns { entry, index, specificity } or null. */
function bestEntry(vocab, data) {
  const entries = (_asData(vocab).interactions) || [];
  let best = null;
  let bestSpec = -1;
  let bestIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    const { ok, specificity } = signatureMatch(entry.signature || {}, data);
    if (ok && specificity > bestSpec) {
      best = entry;
      bestSpec = specificity;
      bestIdx = i;
    }
  }
  return best ? { entry: best, index: bestIdx, specificity: bestSpec } : null;
}

/* A stable identity for a distinct captured control, for grouping evidence rows.
   Signature-shaped (the fields the recorder saw), NOT value-laden: we key on the
   identity the matcher keys on, plus process + window_title so one logical
   control on two screens reads as two rows only when the window differs (that IS
   a different match context for a window-scoped vocab). */
function controlKey(data) {
  data = _asData(data);
  const parts = [
    "p:" + (data.process_name || ""),
    "w:" + (data.window_title || ""),
    "ct:" + (data.control_type || ""),
    "aid:" + (data.automation_id || ""),
    "n:" + (data.name || ""),
    "cn:" + (data.class_name || ""),
  ];
  return parts.join("|");
}

/* The best identity string to SHOW for a captured control (rule 4: raw tokens
   get a friendly-ish rendering, best-identity-first). */
function bestIdentity(data) {
  data = _asData(data);
  if (data.automation_id) return { kind: "automation_id", value: String(data.automation_id) };
  if (data.name) return { kind: "name", value: String(data.name) };
  if (data.class_name) return { kind: "class_name", value: String(data.class_name) };
  if (data.control_type) return { kind: "control_type", value: String(data.control_type) };
  return { kind: "unknown", value: "(unidentified control)" };
}

/* THE one composed human identity line for a control — shown wherever a row
   used to render the four raw signature inputs. Design (R1 App Library pass):
   the four signature fields are the MACHINE's re-identification key (kept as
   data, edited only in the raw-rule expansion); the HUMAN sees one line and
   writes one name.

   Shape: `<ControlType> · "<best identity>" · <window/screen context>`
     - best identity = name || automation_id || class_name (in THAT order — the
       human-legible label first; the machine ladder in bestIdentity() prefers
       automation_id, but a person reads the accessible name best).
     - window/screen context = the explicit `scope` string when the caller has
       one (a named screen), else the signature/event's own window_title, else
       omitted.
     - volatility/weak flags render as a small trailing marker `{kind, note}`
       (NOT baked into the string) so the view can attach the existing tooltip;
       the plain `.text` is always the human sentence with no marker noise.

   `signature` is a signature-shaped object (control_type / automation_id / name
   / class_name / window_title / window_title_regex — a rule signature OR a raw
   captured-event data blob both work, since we only read those fields).
   `scope` (optional) is an explicit screen/window context string to append.

   Returns { text, controlType, identity:{kind,value}, context, marker|null }.
   Pure — unit-tested in vocab-match.test.js. */
function identityLine(signature, scope) {
  const sig = _asData(signature);
  const controlType = String(sig.control_type || "").trim();
  // Human-first identity ladder: name, then automation_id, then class_name.
  let identity;
  if (sig.name) identity = { kind: "name", value: String(sig.name) };
  else if (sig.automation_id) identity = { kind: "automation_id", value: String(sig.automation_id) };
  else if (sig.class_name) identity = { kind: "class_name", value: String(sig.class_name) };
  else identity = { kind: "unknown", value: "" };

  // Window/screen context: explicit scope wins, else the control's own window.
  let context = "";
  if (typeof scope === "string" && scope.trim()) context = scope.trim();
  else if (sig.window_title) context = String(sig.window_title);
  else if (sig.window_title_regex) context = String(sig.window_title_regex);

  // Reuse the volatility/weak flag logic already used by the Name… flow
  // (looksVolatile) — do NOT duplicate the rule shapes. A volatile-looking
  // automation_id we're keying on, or a class_name-only weak identity, gets a
  // small marker with a tooltip the view renders.
  let marker = null;
  if (identity.kind === "automation_id" && looksVolatileId(identity.value)) {
    marker = {
      kind: "volatile",
      note: "This id looks auto-generated (a per-render counter) — it may change between recordings.",
    };
  } else if (identity.kind === "class_name") {
    marker = {
      kind: "weak",
      note: "Weak identity — keyed on a generic class name, with no stable id or accessible label. It may not match reliably.",
    };
  } else if (identity.kind === "unknown") {
    marker = {
      kind: "weak",
      note: "No stable identity was captured for this control.",
    };
  }

  // Compose the sentence. An empty identity reads as "unidentified control".
  const parts = [];
  parts.push(controlType || "Control");
  parts.push(identity.value ? '"' + identity.value + '"' : "(unidentified control)");
  if (context) parts.push(context);
  return { text: parts.join(" · "), controlType, identity, context, marker };
}

/* Heuristic mirror of the discovery volatility flag + vocab-view.looksVolatile:
   an id ending in a render counter (trailing digits after a hyphen/underscore),
   a `prefix-NNN` pattern, or a long hex hash is suspect. Kept here (pure) so
   identityLine has no view dependency; vocab-view.looksVolatile stays the DOM
   caller. Advisory only. */
function looksVolatileId(aid) {
  const s = String(aid || "");
  return /[-_]\d{2,}$/.test(s) || /^[a-z]+-\d+$/i.test(s) || /[0-9a-f]{8,}/i.test(s);
}

/* Derive the minimum signature to hand the add-from-interaction flow, mirroring
   canonical-author.signatureFromInteraction / app_vocab._signature_from_event.
   Duplicated here (tiny, pure) so the matcher has no DOM/require cycle; the
   workbench passes the ACTUAL interaction event to signatureFromInteraction for
   the real derivation, so this is only the fallback shape used in list building. */
function minimalSignature(data) {
  data = _asData(data);
  if (data.automation_id) {
    const sig = { automation_id: String(data.automation_id) };
    if (data.control_type) sig.control_type = String(data.control_type);
    return sig;
  }
  if (data.control_type && data.name) return { control_type: String(data.control_type), name: String(data.name) };
  if (data.class_name && data.name) return { class_name: String(data.class_name), name: String(data.name) };
  if (data.name) return { name: String(data.name) };
  return null;
}

/* The one number the header carries (Memo altitude): how many distinct captured
   controls (in this vocab's scope) got a name, of how many total, and the share
   of raw interactions named. */
function coverage(matched, unnamed, matchedInteractionCount, totalInScopeInteractions) {
  const namedControls = matched.length;
  const totalControls = matched.length + unnamed.length;
  const pctControls = totalControls ? Math.round((100 * namedControls) / totalControls) : 0;
  const pctInteractions = totalInScopeInteractions
    ? Math.round((100 * matchedInteractionCount) / totalInScopeInteractions)
    : 0;
  return {
    namedControls,
    totalControls,
    pctControls,
    matchedInteractions: matchedInteractionCount,
    totalInteractions: totalInScopeInteractions,
    pctInteractions,
  };
}

/* THE workbench engine. `events` are the session's raw events (the viewer's
   State.getSession().events); `vocab` is one App Library vocabulary object
   ({ scope, screens, interactions }). Returns the three lists + coverage +
   screens split, all computed from the captured evidence alone.

   A control that is in the vocab's scope but whose best identity can't be keyed
   cleanly still lands in UNNAMED (never silently dropped) — controlKey always
   returns a key, and a row with no usable add-signature is flagged, not hidden. */
function buildWorkbench(events, vocab) {
  const v = _asData(vocab);
  const interactions = (Array.isArray(events) ? events : []).filter(
    (e) => e && e.type === "interaction"
  );

  // Group every in-scope interaction by its distinct-control key. Out-of-scope
  // interactions belong to other apps and are not this vocab's concern.
  const groups = new Map();      // controlKey -> { data, sampleEvent, count, windows:Set, values:[], matchEntryIndex|null, specificity }
  let inScopeInteractions = 0;
  let matchedInteractions = 0;
  const hitEntryIdx = new Set(); // vocab entry indices that matched >=1 interaction

  for (const ev of interactions) {
    const data = _asData(ev.data);
    if (!scopeMatches(v, data)) continue;
    inScopeInteractions += 1;
    const key = controlKey(data);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        data,
        sampleEvent: ev,
        count: 0,
        windows: new Set(),
        values: [],
        match: null,     // { index, specificity } when a vocab entry named it
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (data.window_title) g.windows.add(String(data.window_title));
    // Masked example value (as-is — the raw stream is already PII-masked by the
    // pipeline; the viewer never un-masks). Keep a small sample.
    const val = data.value !== undefined ? data.value : data.new_value;
    if (val !== undefined && val !== null && val !== "" && g.values.length < 3) {
      const s = String(val);
      if (!g.values.includes(s)) g.values.push(s);
    }
    // Resolve the best matching entry once per group (all members share the
    // keyed identity + window, so the match is stable within a group).
    if (g.match === null && g.count === 1) {
      const be = bestEntry(v, data);
      g.match = be ? { index: be.index, specificity: be.specificity } : undefined;
    }
    if (g.match) {
      matchedInteractions += 1;
      hitEntryIdx.add(g.match.index);
    }
  }

  const matched = [];
  const unnamed = [];
  for (const g of groups.values()) {
    const identity = bestIdentity(g.data);
    const base = {
      key: g.key,
      controlType: g.data.control_type || "",
      identity,
      window: g.data.window_title || "",
      windows: Array.from(g.windows),
      count: g.count,
      values: g.values.slice(),
      sampleEvent: g.sampleEvent,
      data: g.data,
    };
    if (g.match) {
      const entry = (v.interactions || [])[g.match.index] || {};
      matched.push(Object.assign(base, {
        vocabName: entry.name || "(unnamed vocab entry)",
        entryIndex: g.match.index,
        signature: entry.signature || {},
        specificity: g.match.specificity,
      }));
    } else {
      unnamed.push(Object.assign(base, {
        addSignature: minimalSignature(g.data),
      }));
    }
  }

  // MATCHED: most-used first (rule: worklist ordered by occurrence).
  matched.sort((a, b) => b.count - a.count);
  // UNNAMED is the worklist — highest occurrence first (name the most-used first).
  unnamed.sort((a, b) => b.count - a.count);

  // DEAD RULES: vocab entries that named nothing this session.
  const deadRules = [];
  const entries = v.interactions || [];
  for (let i = 0; i < entries.length; i++) {
    if (hitEntryIdx.has(i)) continue;
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    deadRules.push({
      entryIndex: i,
      name: entry.name || "(unnamed vocab entry)",
      signature: entry.signature || {},
    });
  }

  const cov = coverage(matched, unnamed, matchedInteractions, inScopeInteractions);

  return {
    matched,
    unnamed,
    deadRules,
    coverage: cov,
    screens: buildScreens(groups, v),
    inScopeInteractions,
  };
}

/* R4 (next-act rail act 1): how many DISTINCT captured controls no loaded vocab
   named, across the whole session. Advisory (mirrors, not the pipeline).
   Computed as: every distinct in-session control (controlKey) MINUS the union of
   the controls any vocab matched. This deliberately does NOT sum each vocab's
   UNNAMED list -- the shipped vocabs often carry an empty scope (which matches
   every app), so per-vocab summing double-counts. A control named by ANY vocab
   is "named" for this rail signal (the honest "is anything still unnamed?"
   question, not the per-vocab "is THIS selector right?" the workbench answers).

   `events` = the session's raw events; `vocabs` = the loaded App Library
   vocabularies. Returns { distinctControls, named, unnamed }. */
function countUnnamedControls(events, vocabs) {
  const interactions = (Array.isArray(events) ? events : []).filter(
    (e) => e && e.type === "interaction");
  const allKeys = new Set();
  for (const ev of interactions) allKeys.add(controlKey(_asData(ev.data)));
  const named = new Set();
  for (const vocab of (Array.isArray(vocabs) ? vocabs : [])) {
    const wb = buildWorkbench(events, vocab);
    for (const m of wb.matched) named.add(m.key);
  }
  let unnamed = 0;
  for (const k of allKeys) if (!named.has(k)) unnamed += 1;
  return { distinctControls: allKeys.size, named: named.size, unnamed };
}

/* Distinct observed window titles for this vocab's app, split into those a
   `screens` entry's window_title_regex matches vs. those unnamed. */
function buildScreens(groups, vocab) {
  const v = _asData(vocab);
  const screens = Array.isArray(v.screens) ? v.screens : [];
  const compiledScreens = screens
    .filter((s) => s && s.window_title_regex)
    .map((s) => ({ screen: s, re: _compile(s.window_title_regex) }))
    .filter((s) => s.re);

  const titleCounts = new Map(); // title -> count of interactions
  for (const g of groups.values()) {
    for (const w of g.windows) {
      titleCounts.set(w, (titleCounts.get(w) || 0) + g.count);
    }
    if (!g.windows.size && g.data.window_title) {
      titleCounts.set(g.data.window_title, (titleCounts.get(g.data.window_title) || 0) + g.count);
    }
  }

  const matchedTitles = [];
  const unnamedTitles = [];
  for (const [title, count] of titleCounts.entries()) {
    const hit = compiledScreens.find((cs) => cs.re.test(title));
    if (hit) {
      matchedTitles.push({ title, count, screenId: hit.screen.id, screenName: hit.screen.name || hit.screen.id });
    } else {
      unnamedTitles.push({ title, count });
    }
  }
  matchedTitles.sort((a, b) => b.count - a.count);
  unnamedTitles.sort((a, b) => b.count - a.count);
  return { matched: matchedTitles, unnamed: unnamedTitles };
}

/* Suggest a window_title_regex for a screen from the observed title variants of
   ONE logical window. The volatile token (the part that differs across variants)
   becomes the wildcard; the stable frame is escaped literally. When only one
   variant was observed, escape the whole thing and say so (single=true).

   `titles` are the observed title strings the analyst grouped as one screen.
   Returns { regex, single, commonPrefix, commonSuffix }. Mirrors the intent of
   app_vocab._scope_for_app's common-prefix idea, extended to prefix+suffix so an
   embedded record number in the MIDDLE ("Create INC0010010 | Incident") is the
   wildcard. */
function suggestScreenRegex(titles) {
  const uniq = Array.from(new Set((titles || []).filter((t) => typeof t === "string" && t)));
  if (!uniq.length) return { regex: "", single: true, commonPrefix: "", commonSuffix: "" };
  if (uniq.length === 1) {
    return {
      regex: ".*" + escapeRegex(uniq[0]) + ".*",
      single: true,
      commonPrefix: uniq[0],
      commonSuffix: "",
    };
  }
  const prefix = commonPrefix(uniq);
  const suffix = commonSuffix(uniq, prefix.length);
  // If nothing is shared, fall back to matching any of the observed titles by
  // their shared app token would be guesswork — escape-anchor on the first and
  // flag single=false so the analyst edits.
  if (!prefix && !suffix) {
    return {
      regex: ".*" + escapeRegex(uniq[0]) + ".*",
      single: false,
      commonPrefix: "",
      commonSuffix: "",
    };
  }
  // Build ".*<prefix>.*<suffix>.*" but collapse redundant wildcards when the
  // prefix or suffix is empty (avoid a cosmetic ".*.*").
  let regex = ".*";
  if (prefix) regex += escapeRegex(prefix) + ".*";
  if (suffix) regex += escapeRegex(suffix) + ".*";
  return { regex, single: false, commonPrefix: prefix, commonSuffix: suffix };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commonPrefix(strings) {
  if (!strings.length) return "";
  let p = strings[0];
  for (const s of strings) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}

function commonSuffix(strings, reserve) {
  if (!strings.length) return "";
  // Don't let the suffix overlap the prefix (reserve chars already claimed).
  let s0 = strings[0];
  let suf = s0;
  for (const s of strings) {
    let i = 0;
    while (
      i < suf.length &&
      i < s.length &&
      suf[suf.length - 1 - i] === s[s.length - 1 - i]
    ) i++;
    suf = suf.slice(suf.length - i);
    if (!suf) break;
  }
  // Trim so prefix + suffix never overlap on the shortest string.
  const minLen = Math.min.apply(null, strings.map((s) => s.length));
  const maxSuffix = Math.max(0, minLen - reserve);
  if (suf.length > maxSuffix) suf = suf.slice(suf.length - maxSuffix);
  return suf;
}

module.exports = {
  SIG_FIELDS,
  INTERACTIVE_CONTROL_TYPES,
  triageSnapshotCandidates,
  scopeMatches,
  signatureMatch,
  bestEntry,
  controlKey,
  bestIdentity,
  identityLine,
  looksVolatileId,
  minimalSignature,
  coverage,
  buildWorkbench,
  countUnnamedControls,
  buildScreens,
  suggestScreenRegex,
  escapeRegex,
  commonPrefix,
  commonSuffix,
};
