/*
 * PDT 1.0 Glance view — timeline-as-story for the recording worker.
 *
 * See docs/PDT-1.0-SPEC.md §4.1.2 and ADR-0031. Glance is the default
 * mode a worker lands on immediately after their session normalises:
 * a single-column scrubbing story of what was observed, with AI labels
 * overlaid and one-click corrections. The corrections feed the
 * disagreement-as-feedback loop (ADR-0029 §4.3).
 *
 * Integration: Glance is a session-mode (alongside Cockpit and Workshop)
 * exposed via the topbar toggle. It reuses the existing timeline
 * subsystem and the annotations.json sidecar — no new pipeline output
 * required.
 *
 * Phase 3 scaffold. Renders the per-step strip with AI labels overlaid;
 * corrections persist to annotations.json's `disagreements[]`.
 */

"use strict";

const State = require("../state.js");
const { escapeHtml } = require("../dom.js");

function _fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m " + (sec ? sec + "s" : "");
  return sec + "s";
}

function _fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) { return "—"; }
}

function _h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/**
 * Disagreement-as-feedback: when a worker (or any user) edits an AI-
 * generated step name, the change is recorded in annotations.disagreements[]
 * so the next normalisation pass can use it as a constraint.
 * (ADR-0029 §4.3 — no live retraining; constraints applied on re-mine.)
 */
function _recordDisagreement(stepId, oldLabel, newLabel) {
  const session = State.getSession();
  if (!session || !session.annotations) return;
  const ann = session.annotations;
  if (!Array.isArray(ann.disagreements)) ann.disagreements = [];
  ann.disagreements.push({
    disagreement_id: "dis-" + Math.random().toString(36).slice(2, 10),
    step_id: stepId,
    field: "name",
    rejected: oldLabel,
    proposed: newLabel,
    source: "glance",
    ts: new Date().toISOString(),
  });
}

function _editStepName(step) {
  const current = step.name || "";
  const next = window.prompt("Edit activity name", current);
  if (next == null || next === current) return;
  step.name = next;
  step.state = "edited";
  _recordDisagreement(step.step_id, current, next);
  // Persist + re-render — defer to global persistAnnotations hook.
  if (typeof window !== "undefined" && typeof window._glancePersist === "function") {
    window._glancePersist();
  }
  render();
}

function render() {
  const host = document.getElementById("session-layout-glance");
  if (!host) return;

  const session = State.getSession();
  host.innerHTML = "";

  if (!session) {
    host.appendChild(_h("div", { class: "glance-empty" },
      _h("div", { class: "glance-empty-title" }, "Open a session to see your work"),
      _h("div", { class: "glance-empty-hint" },
        "Glance shows a chronological story of what we observed in your session. " +
        "Click any activity name to correct it.")));
    return;
  }

  const ann = session.annotations || {};
  const steps = Array.isArray(ann.steps) ? ann.steps : [];

  // Header
  const header = _h("div", { class: "glance-header" },
    _h("h2", { class: "glance-h2" }, "Your session"),
    _h("p", { class: "glance-subtitle" },
      "We labelled what we saw. Skim, correct anything that's wrong, then submit."),
  );
  host.appendChild(header);

  if (steps.length === 0) {
    host.appendChild(_h("div", { class: "glance-empty-section" },
      "No steps yet. Run Analyze on this session to populate the timeline."));
    return;
  }

  // Story strip: chronological list of step bands
  const strip = _h("ol", { class: "glance-strip" });
  steps.forEach((step, idx) => {
    const start = (step.time_range && step.time_range.start) || "";
    const end = (step.time_range && step.time_range.end) || "";
    let dur_ms = 0;
    if (start && end) {
      const a = new Date(start).getTime();
      const b = new Date(end).getTime();
      if (isFinite(a) && isFinite(b)) dur_ms = b - a;
    }
    const isAi = step.state === "auto_suggested" || step.state === "auto_matched";
    const stateLabel = step.state === "auto_suggested" ? "AI suggestion"
      : step.state === "auto_matched" ? "AI matched template"
      : step.state === "edited" ? "Edited"
      : step.state === "manually_authored" ? "Manual"
      : "";

    const li = _h("li", { class: "glance-step" + (isAi ? " glance-step-ai" : "") },
      _h("div", { class: "glance-step-time" }, _fmtTime(start)),
      _h("div", { class: "glance-step-body" },
        _h("div", { class: "glance-step-name", title: "Click to correct" },
          _h("button", {
            class: "glance-step-edit",
            title: "Correct this label",
            onClick: () => _editStepName(step),
          }, step.name || "(unnamed)"),
          stateLabel ? _h("span", { class: "glance-step-state" }, stateLabel) : null,
        ),
        _h("div", { class: "glance-step-meta" },
          _h("span", { class: "glance-step-dur" }, _fmtDuration(dur_ms)),
          step.flags && step.flags.waste
            ? _h("span", { class: "glance-step-flag" }, "flagged as waste")
            : null,
        ),
      ),
    );
    strip.appendChild(li);
  });
  host.appendChild(strip);

  // Footer
  host.appendChild(_h("div", { class: "glance-footer" },
    _h("span", { class: "glance-footer-hint" },
      "When you're done, this session goes to the consultant.")));
}

module.exports = { render };
