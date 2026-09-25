"use strict";

/*
 * save-state.js: the save state in the top bar (#save-state). Every change
 * the analyst makes saves itself to the project folder; this one quiet word
 * says so:
 *   "Saved"      the writes reached the folder (the time of the last one and
 *                the folder in its tooltip);
 *   "Saving..."  a write is under way;
 *   "Not saved"  a write failed (in the error colour, what was not saved and
 *                why in its tooltip), until a later save succeeds.
 * The error toast of each act stays as it is.
 *
 * The writes: annotations.json (every edit, through viewer:saveAnnotations),
 * the video, the transcript (its sync, attaching and removing it), and the
 * screenshots and attachments the analyst adds. The main process reports each
 * one (main.js _projectWrite, on viewer:projectWrite): { folder, channel,
 * phase: "start" } as it starts, then { folder, channel, phase: "end", ok,
 * error, code }. channel: "annotations", "video", "transcript", "screenshot"
 * or "attachment". The edited maps are written in the renderer and report
 * the same way through noteWrite, channel "map" (refmap-ui.js: a new copy or
 * a duplicate; bpmn-viewer.js: the editor's delayed write, from the moment an
 * edit waits for it). The analysis and the exports are not saves of the
 * analyst's work and report nothing.
 *
 * Rules:
 *   1. "Saving..." shows once a write has lasted SAVING_DELAY_MS (a video
 *      copy, a transcript import), so a quick save does not flash. The word
 *      fades in again after each save (a short fade; none with reduced
 *      motion).
 *   2. A failed annotations save leaves the change on screen, and only a
 *      later annotations save writes it: that failure stays until an
 *      annotations save succeeds. A failed map save is the same: the edit
 *      stays in the editor and only a later map save writes it. A failed
 *      write of another kind left nothing waiting on screen (the file was not
 *      added, the sync was not kept): the next successful save of any kind
 *      ends it.
 *   3. An annotations.json that cannot be read (the banner at the top of the
 *      page) is "Not saved" from the moment the project opens: no change is
 *      saved until it is fixed.
 *   4. Opening another project starts over; a report for another folder
 *      changes nothing.
 *   5. A hand-off opened read only (lane HV, contract C20) says "Read only",
 *      with its version in the tooltip, and no report changes that: nothing
 *      is written there. So does a project open for editing in another
 *      window (lane MW), the tooltip saying so.
 *
 * The state logic is pure (initialState, withUnreadable, applyWrite, view),
 * so the unit tests pin it; mount, projectOpened and noteWrite drive the
 * element. No electron here: renderer.js passes the IPC subscription in.
 */

const Handoff = require("./handoff.js");

const SAVING_DELAY_MS = 300;
const UNREADABLE = "ANNOTATIONS_UNREADABLE";

/* What a failed write of each kind did not save, for the tooltip. */
const WHAT = {
  annotations: "Your change",
  video: "The video",
  transcript: "The transcript change",
  screenshot: "The screenshot",
  attachment: "The attachment",
  map: "The map",
};

/* The kinds whose failed write leaves a change waiting on screen, written
   only by a later save of the same kind (rule 2). */
const WAITS = new Set(["annotations", "map"]);

/* Plain words for the reasons a write fails most often (a file-system error
   code, or NO_PROJECT from main.js when the folder is no project any more). */
const SHARED_OR_READ_ONLY = "a file in the project folder is read-only, or another program holds it";
const REASONS = {
  EPERM: SHARED_OR_READ_ONLY,
  EACCES: SHARED_OR_READ_ONLY,
  EBUSY: "another program holds a file in the project folder",
  EROFS: "the project folder is on a drive that cannot be written to",
  ENOSPC: "the disk is full",
  ENOENT: "a file or folder of the project was not found (was the project folder moved or renamed?)",
  NO_PROJECT: "the project folder was not found (was it moved, renamed or deleted?)",
};

/* Whether two folder paths name the same folder (Windows: any case, either
   slash, a trailing slash or not). */
function sameFolder(a, b) {
  if (!a || !b) return false;
  const norm = (p) => String(p).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/* The state of a project just opened. `unreadable`: the load's
   annotationsError, when annotations.json cannot be read. `readOnly`: the
   line of a hand-off opened read only (rule 5), else null. `elsewhere`
   (lane MW): true when it is read only because another window has it open
   for editing. */
function initialState(folder, unreadable, readOnly, elsewhere) {
  return withUnreadable({ folder: folder || null, inFlight: 0, savingShown: false, savedAt: null, failures: [],
    readOnly: readOnly || null, elsewhere: !!(readOnly && elsewhere) }, unreadable);
}

/* The state with the unreadable annotations.json failure as the latest load
   found it: there when the file cannot be read, gone once it can. */
function withUnreadable(state, unreadable) {
  const failures = state.failures.filter((f) => f.code !== UNREADABLE);
  if (unreadable) {
    failures.push({ channel: "annotations", code: UNREADABLE, error: String(unreadable.reason || ""), at: null });
  }
  return Object.assign({}, state, { failures });
}

/* The state after one report `evt` from the main process, which arrived at
   `at` (a Date). A report for another folder changes nothing (the same
   state comes back). */
function applyWrite(state, evt, at) {
  if (!evt || !sameFolder(evt.folder, state.folder) || state.readOnly) return state;
  if (evt.phase === "start") return Object.assign({}, state, { inFlight: state.inFlight + 1 });
  if (evt.phase !== "end") return state;
  let inFlight = state.inFlight;
  if (inFlight > 0) inFlight--;   // an end without its start never counts below zero
  const channel = String(evt.channel || "");
  let failures;
  if (evt.ok) {
    // What this write saved is on disk, and a failure that left nothing
    // waiting is over; a failed annotations (or map) save waits for a save
    // of its kind, the only one that writes the change it left on screen.
    failures = state.failures.filter((f) => WAITS.has(f.channel) && f.channel !== channel);
  } else {
    // The latest failure of each kind is the one to say.
    failures = state.failures.filter((f) => f.channel !== channel)
      .concat([{ channel, code: evt.code == null ? null : String(evt.code), error: String(evt.error || ""), at }]);
  }
  return Object.assign({}, state, {
    inFlight,
    savingShown: inFlight > 0 && state.savingShown,
    savedAt: evt.ok ? at : state.savedAt,
    failures,
  });
}

function _sentence(s) {
  return /[.!?]$/.test(s) ? s : s + ".";
}

/* Why a write failed, in plain words, with what the system said after it. */
function reasonText(f) {
  const raw = String(f.error || "").trim();
  const m = /^([A-Z][A-Z0-9_]*):/.exec(raw);
  const code = f.code || (m ? m[1] : null);
  const words = code ? REASONS[code] : null;
  if (!words) return _sentence(raw || "no reason was given");
  if (code === "NO_PROJECT" || !raw) return words + ".";
  return words + " (" + raw.replace(/[.\s]+$/, "") + ").";
}

/* One failure as the tooltip says it. */
function failureSentence(f) {
  if (f.code === UNREADABLE) {
    return "The file annotations.json in the project folder cannot be read, so no change is saved until it is fixed: the message at the top of the page says how.";
  }
  let s = (WHAT[f.channel] || "A change") + " was not saved: " + reasonText(f);
  if (f.channel === "annotations" && f.code !== "ANALYSIS_RUNNING") {
    s += " It stays on screen and is saved with your next change once the problem is fixed.";
  }
  return s;
}

/* The time of a save in the tooltip: the time of day, to the second. */
function defaultTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* What the element shows for `state`: { kind: "saved" | "saving" |
   "failed", text, title }. */
function view(state, fmtTime) {
  const fmt = fmtTime || defaultTime;
  const where = state.folder ? ": " + state.folder : "";
  if (state.readOnly) {
    return { kind: "readonly", text: "Read only",
      title: state.elsewhere
        ? "Open in another window: read only here. Changes are made in the window where this project was opened first."
        : state.readOnly + ", opened read only: nothing here can change. Changes are made in the analyst's project." };
  }
  if (state.inFlight > 0 && state.savingShown) {
    return { kind: "saving", text: "Saving...", title: "Saving to the project folder" + where + "." };
  }
  if (state.failures.length) {
    // The change waiting on screen first, then the other failures, latest first.
    const waiting = state.failures.filter((f) => f.channel === "annotations");
    const others = state.failures.filter((f) => f.channel !== "annotations").reverse();
    return { kind: "failed", text: "Not saved", title: waiting.concat(others).map(failureSentence).join(" ") };
  }
  return {
    kind: "saved", text: "Saved",
    title: (state.savedAt ? "Saved at " + fmt(state.savedAt) + ". " : "") +
      "Every change saves itself to the project folder" + where + ".",
  };
}

/* ---- The element ---------------------------------------------------------- */

const DEFAULTS = {
  now: () => new Date(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  fmtTime: defaultTime,
  subscribe: null,
};

let _el = null;
let _deps = DEFAULTS;
let _state = initialState(null);
let _timer = null;

function _clearTimer() {
  if (_timer) { _deps.clearTimeout(_timer); _timer = null; }
}

function _render(pulse) {
  if (!_el) return;
  const v = view(_state, _deps.fmtTime);
  const changed = _el.textContent !== v.text;
  if (changed) _el.textContent = v.text;
  if (_el.title !== v.title) _el.title = v.title;
  _el.dataset.state = v.kind;
  if (changed || pulse) {
    _el.classList.remove("fade");
    void _el.offsetWidth;   // restarts the fade
    _el.classList.add("fade");
  }
}

function _showSaving() {
  _timer = null;
  if (_state.inFlight === 0) return;
  _state = Object.assign({}, _state, { savingShown: true });
  _render(false);
}

/* Bind the element (once, at boot) and start listening. deps: { subscribe }
   (Ipc.onProjectWrite, called with noteWrite); the tests also pass now,
   setTimeout, clearTimeout and fmtTime. */
function mount(el, deps) {
  _clearTimer();
  _el = el || null;
  _deps = Object.assign({}, DEFAULTS, deps || {});
  _state = initialState(null);
  if (typeof _deps.subscribe === "function") _deps.subscribe(noteWrite);
  _render(false);
}

/* A project was opened, or loaded again (flow-view.js loadSessionIntoView).
   Another folder starts over; the same folder keeps its state, with the
   unreadable annotations.json failure as this load found it. */
function projectOpened(session) {
  const folder = (session && session.sessionFolder) || null;
  const unreadable = (session && session.annotationsError) || null;
  // Lane MW: read only because another window has the project open for
  // editing (read-only.js isOpenElsewhere).
  const elsewhere = !!(session && session.readOnly === true && session.openElsewhere === true);
  const readOnly = session && session.readOnly === true
    ? (elsewhere ? "Open in another window" : Handoff.handedOffLine(Handoff.latest(session.annotations)) || "A hand-off") : null;
  if (folder && sameFolder(folder, _state.folder)) {
    _state = Object.assign(withUnreadable(_state, unreadable), { readOnly, elsewhere });
  } else {
    _clearTimer();
    _state = initialState(folder, unreadable, readOnly, elsewhere);
  }
  _render(false);
}

/* One report from the main process (viewer:projectWrite). */
function noteWrite(evt) {
  const next = applyWrite(_state, evt, _deps.now());
  if (next === _state) return;
  _state = next;
  if (_state.inFlight === 0) _clearTimer();
  else if (!_state.savingShown && !_timer) _timer = _deps.setTimeout(_showSaving, SAVING_DELAY_MS);
  _render(!!(evt && evt.phase === "end" && evt.ok));
}

module.exports = {
  SAVING_DELAY_MS,
  sameFolder, initialState, withUnreadable, applyWrite, view,
  mount, projectOpened, noteWrite,
};
