/*
 * PDT 1.0 Glance view — timeline-as-story for the recording worker.
 *
 * See docs/PDT-1.0-SPEC.md §4.1.2 and ADR-0031. Glance is the default
 * mode a worker lands on immediately after their session normalises:
 * a two-column scrubbing story of what was observed (timeline on the
 * left), with a small summary + "Submit to consultant" card on the
 * right. AI labels are overlaid and corrections feed the
 * disagreement-as-feedback loop (ADR-0029 §4.3).
 *
 * Integration: Glance is a session-mode (alongside Cockpit and Workshop)
 * exposed via the topbar toggle. It reuses the existing timeline
 * subsystem and the annotations.json sidecar — no new pipeline output
 * required.
 *
 * Phase 3 scaffold. Renders the per-step strip with AI labels overlaid;
 * corrections persist to annotations.json's `disagreements[]`. Submit
 * is a soft-state action — it flips annotations.glance_submitted to
 * true and re-renders so the worker sees a confirmation.
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
    if (typeof c === "string" || typeof c === "number") {
      el.appendChild(document.createTextNode(String(c)));
    } else {
      el.appendChild(c);
    }
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

function _commitRename(step, current, next) {
  if (next == null) return;
  next = String(next).trim();
  if (!next || next === current) return;
  step.name = next;
  step.state = "edited";
  _recordDisagreement(step.step_id, current, next);
  if (typeof window !== "undefined" && typeof window._glancePersist === "function") {
    window._glancePersist();
  }
  render();
}

// Spec §4.3: disagreement-as-first-class-verb — a one-click reject. The
// worker says "this isn't an activity at all" and the step is suppressed
// from the deliverable until the consultant revisits it.
function _rejectStep(step) {
  const current = step.name || "";
  step.state = "hidden";
  if (!step.flags) step.flags = {};
  step.flags.rejected_by_worker = true;
  // Record as a disagreement with no proposed name — the next normalise
  // pass treats this step as known-noise.
  const session = State.getSession();
  if (session && session.annotations) {
    if (!Array.isArray(session.annotations.disagreements)) {
      session.annotations.disagreements = [];
    }
    session.annotations.disagreements.push({
      disagreement_id: "dis-" + Math.random().toString(36).slice(2, 10),
      step_id: step.step_id,
      field: "is_activity",
      rejected: current,
      proposed: null,
      source: "glance",
      ts: new Date().toISOString(),
    });
  }
  if (typeof window !== "undefined" && typeof window._glancePersist === "function") {
    window._glancePersist();
  }
  render();
}

/* Submit-to-consultant — soft state. Flips annotations.glance_submitted
   so the worker sees a confirmation banner and the consultant has a
   visible signal that the session has been reviewed. The flag is
   non-destructive: it doesn't lock anything, the consultant can still
   edit. */
function _submitToConsultant() {
  const session = State.getSession();
  if (!session || !session.annotations) return;
  session.annotations.glance_submitted = {
    submitted: true,
    submitted_at: new Date().toISOString(),
    source: "glance",
  };
  if (typeof window !== "undefined" && typeof window._glancePersist === "function") {
    window._glancePersist();
  }
  render();
}

function _undoSubmit() {
  const session = State.getSession();
  if (!session || !session.annotations) return;
  delete session.annotations.glance_submitted;
  if (typeof window !== "undefined" && typeof window._glancePersist === "function") {
    window._glancePersist();
  }
  render();
}

/**
 * Compute the worker-progress summary the right-rail card needs. Each
 * step counts toward exactly one bucket based on its current state and
 * flags. Steps the worker has not yet acted on land in "remaining".
 *
 * confirmed = the worker has skimmed and accepted the auto label (we
 * treat `state: "auto_matched"` and explicit confirmation as a yes)
 * corrected = the worker renamed → `state: "edited"`
 * rejected  = the worker dropped it → `flags.rejected_by_worker`
 * remaining = everything else (initial auto_suggested + manually_authored)
 */
function _computeSummary(allSteps) {
  const summary = { confirmed: 0, corrected: 0, rejected: 0, remaining: 0, total: 0 };
  for (const s of allSteps) {
    if (!s) continue;
    summary.total++;
    if (s.flags && s.flags.rejected_by_worker) {
      summary.rejected++;
    } else if (s.state === "edited") {
      summary.corrected++;
    } else if (s.state === "auto_matched" || s.state === "confirmed") {
      summary.confirmed++;
    } else {
      summary.remaining++;
    }
  }
  return summary;
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
  const allSteps = Array.isArray(ann.steps) ? ann.steps : [];
  // Hide steps the worker explicitly rejected ("not an activity") and the
  // analyst-suppressed `hidden` ones. They remain in annotations.json — the
  // consultant can still see them in Workshop → Steps via the hidden chip.
  const steps = allSteps.filter(s => {
    if (!s) return false;
    if (s.state === "hidden") return false;
    if (s.flags && s.flags.rejected_by_worker) return false;
    return true;
  });

  const summary = _computeSummary(allSteps);
  const submitted = ann.glance_submitted && ann.glance_submitted.submitted === true;

  // Header (spans the full grid row so the worker sees the same
  // "Your session" headline regardless of viewport width).
  host.appendChild(_h("div", { class: "glance-header" },
    _h("h2", { class: "glance-h2" }, "Your session"),
    _h("p", { class: "glance-subtitle" },
      "We labelled what we saw. Skim, correct anything that's wrong, then submit."),
  ));

  // Main column: timeline strip.
  const main = _h("section", { class: "glance-main" });
  // Side rail: summary + Submit CTA. Visible on wide viewports;
  // stacks below the strip on narrow ones (handled in CSS).
  const rail = _h("aside", { class: "glance-rail" });

  if (steps.length === 0) {
    main.appendChild(_h("div", { class: "glance-empty-section" },
      "No steps yet. Run Analyze on this session to populate the timeline."));
  } else {
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
      // Provenance labels — call things what they actually are. Heuristic
      // auto-suggestion is NOT "AI suggestion" (that misled the worker into
      // thinking the LLM Naming Layer drove this label; it didn't). Reserve
      // the AI badge for `auto_named` — set by the Naming Layer when an LLM
      // name actually replaced the heuristic process_label.
      const wasLlmNamed = step.state === "auto_named"
                       || (step.name_source === "llm");
      const isHeuristic = step.state === "auto_suggested";
      const stateLabel =
          wasLlmNamed                            ? "AI-named"
        : isHeuristic                            ? "Auto-suggested"
        : step.state === "auto_matched"          ? "Template-matched"
        : step.state === "edited"                ? "Edited"
        : step.state === "manually_authored"    ? "Manual"
        : "";
      const stateCls =
          wasLlmNamed   ? "glance-step-state glance-state-ai"
        : isHeuristic   ? "glance-step-state glance-state-auto"
        :                 "glance-step-state";

      // The activity name renders as plain text — NOT as a button-styled link.
      // The original "hyperlink-looking-but-going-nowhere" UX confused workers
      // (clicked it, expected a destination, got a broken window.prompt). Now:
      // a clear pencil icon to rename inline + an X icon to reject this step
      // entirely. The disagreement loop (ADR-0029 §4.3) records both.
      const nameSpan = _h("span", { class: "glance-step-text" }, step.name || "(unnamed)");

      function _enterEditMode(focusOn) {
        if (nameSpan.parentNode.querySelector(".glance-step-input")) return;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "glance-step-input";
        input.value = step.name || "";
        input.title = "Enter to save · Esc to cancel";
        nameSpan.parentNode.replaceChild(input, nameSpan);
        input.focus();
        input.select();
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          _commitRename(step, step.name || "", input.value);
        };
        const cancel = () => {
          if (committed) return;
          committed = true;
          render();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        });
        input.addEventListener("blur", commit);
      }

      const li = _h("li", { class: "glance-step" + (wasLlmNamed ? " glance-step-ai" : "") },
        _h("div", { class: "glance-step-time" }, _fmtTime(start)),
        _h("div", { class: "glance-step-body" },
          _h("div", { class: "glance-step-name" },
            nameSpan,
            stateLabel ? _h("span", { class: stateCls }, stateLabel) : null,
            _h("span", { class: "glance-step-actions" },
              _h("button", {
                class: "glance-step-action glance-step-action-edit",
                title: "Rename this activity",
                "aria-label": "Rename",
                onClick: (e) => { e.stopPropagation(); _enterEditMode(); },
              }, "✎ Rename"),
              _h("button", {
                class: "glance-step-action glance-step-action-reject",
                title: "This wasn't really an activity — drop it from the deliverable",
                "aria-label": "Reject",
                onClick: (e) => {
                  e.stopPropagation();
                  if (window.confirm("Drop \"" + (step.name || "this step") + "\" from this session? You can restore it from Workshop.")) {
                    _rejectStep(step);
                  }
                },
              }, "✗ Not an activity"),
            ),
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
    main.appendChild(strip);
  }

  // ---- Right-rail: summary + Submit CTA ------------------------------
  // Submitted state takes over the entire rail — the worker should see
  // a clear "this is done, here's how to undo" rather than the Submit
  // button still glaring at them.
  if (submitted) {
    const submittedAt = ann.glance_submitted.submitted_at || "";
    let when = "";
    try {
      when = submittedAt
        ? new Date(submittedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
        : "";
    } catch (_) { when = ""; }
    rail.appendChild(_h("section", { class: "glance-rail-card glance-rail-submitted" },
      _h("div", { class: "glance-rail-submitted-check", "aria-hidden": "true" },
        _h("span", { html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' })),
      _h("div", { class: "glance-rail-submitted-title" }, "Submitted to consultant"),
      _h("div", { class: "glance-rail-submitted-hint" },
        when ? "Sent " + when + ". The consultant takes it from here." :
               "The consultant takes it from here."),
      _h("button", {
        class: "glance-rail-undo",
        title: "Pull the session back — you can still edit labels.",
        onClick: _undoSubmit,
      }, "Undo submit"),
    ));
  } else {
    // Progress card.
    const totalStr = summary.total + " step" + (summary.total === 1 ? "" : "s");
    rail.appendChild(_h("section", { class: "glance-rail-card glance-rail-progress" },
      _h("div", { class: "glance-rail-card-label" }, "Your review · " + totalStr),
      _h("ul", { class: "glance-rail-summary" },
        _h("li", { class: "glance-rail-summary-row glance-rail-row-confirmed" },
          _h("span", { class: "glance-rail-summary-val" }, String(summary.confirmed)),
          _h("span", { class: "glance-rail-summary-lbl" }, "confirmed")),
        _h("li", { class: "glance-rail-summary-row glance-rail-row-corrected" },
          _h("span", { class: "glance-rail-summary-val" }, String(summary.corrected)),
          _h("span", { class: "glance-rail-summary-lbl" }, "corrected")),
        _h("li", { class: "glance-rail-summary-row glance-rail-row-rejected" },
          _h("span", { class: "glance-rail-summary-val" }, String(summary.rejected)),
          _h("span", { class: "glance-rail-summary-lbl" }, "rejected")),
        _h("li", { class: "glance-rail-summary-row glance-rail-row-remaining" },
          _h("span", { class: "glance-rail-summary-val" }, String(summary.remaining)),
          _h("span", { class: "glance-rail-summary-lbl" }, "remaining")),
      ),
    ));

    // Submit CTA card.
    const ctaBody = summary.remaining === 0
      ? "Everything's been reviewed. Ready to send."
      : summary.remaining + " step" + (summary.remaining === 1 ? "" : "s") +
        " still not reviewed — sending now means the consultant works from the auto labels for those.";
    rail.appendChild(_h("section", { class: "glance-rail-card glance-rail-cta" },
      _h("div", { class: "glance-rail-card-label" }, "Done?"),
      _h("p", { class: "glance-rail-cta-body" }, ctaBody),
      _h("button", {
        class: "glance-rail-submit",
        title: "Mark this session as worker-reviewed. The consultant will pick it up.",
        onClick: _submitToConsultant,
      }, "Submit to consultant →"),
    ));
  }

  host.appendChild(main);
  host.appendChild(rail);

  // Footer hint (full width below the grid). Removed when submitted —
  // the submitted card replaces the cue.
  if (!submitted) {
    host.appendChild(_h("div", { class: "glance-footer" },
      _h("span", { class: "glance-footer-hint" },
        "When you're done, this session goes to the consultant.")));
  }
}

module.exports = { render };
