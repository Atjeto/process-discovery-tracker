"use strict";

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderPhaseList(host, phases, selectedId, onSelect) {
    host.innerHTML = "";
    if (!phases || !phases.length) {
      host.innerHTML = `
        <div class="empty-pane">
          <p><strong>No phases yet.</strong></p>
          <p>Phases group steps into milestones. Two ways to create them:</p>
          <ol>
            <li>Switch to <strong>Steps</strong>, Ctrl+click two or more steps, then click <em>Group selected steps into phase</em>.</li>
            <li>Load a Process Template with phases defined, then re-normalize the session.</li>
          </ol>
        </div>`;
      return;
    }
    for (const p of phases) {
      const row = document.createElement("div");
      row.className = "phase-row" + (p.phase_id === selectedId ? " selected" : "");
      row.dataset.phaseId = p.phase_id;
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(p.state)}" title="${escapeAttr(p.state)}"></span>
        <span class="phase-name">${escapeHtml(p.name)}</span>
        <span class="phase-count">${(p.step_ids || []).length} steps</span>
      `;
      row.addEventListener("click", () => onSelect && onSelect(p.phase_id));
      host.appendChild(row);
    }
  }

  function renderPhaseDetail(host, phase, steps, callbacks) {
    if (!phase) {
      host.innerHTML = `
        <div class="empty-pane">
          <p>Pick a phase on the left to rename it, see which steps it contains, or remove steps from it.</p>
        </div>`;
      return;
    }
    const containedSteps = (phase.step_ids || []).map(sid =>
      (steps || []).find(s => s.step_id === sid)).filter(Boolean);
    host.innerHTML = `
      <label>Name <input type="text" id="phase-name" value="${escapeAttr(phase.name)}"></label>
      <label>Description <textarea id="phase-desc">${escapeHtml(phase.description || "")}</textarea></label>
      <div class="phase-step-list" id="phase-step-list">
        ${containedSteps.map(s => `
          <div class="phase-step-row" draggable="true" data-step-id="${escapeAttr(s.step_id)}">
            <span class="grip">⋮⋮</span>
            <span class="step-name">${escapeHtml(s.name)}</span>
            <button class="remove-step" data-step-id="${escapeAttr(s.step_id)}" title="Remove from phase">×</button>
          </div>
        `).join("")}
      </div>
      <div class="actions">
        <button id="btn-phase-save" class="primary">Save</button>
        <button id="btn-phase-split">Split here</button>
        <button id="btn-phase-delete" class="danger">Delete</button>
      </div>`;
    host.querySelectorAll(".remove-step").forEach(btn => {
      btn.addEventListener("click", () => {
        const sid = btn.dataset.stepId;
        if (callbacks.onRemoveStep) callbacks.onRemoveStep(phase.phase_id, sid);
      });
    });
    document.getElementById("btn-phase-save").addEventListener("click", () => {
      if (!callbacks.onSave) return;
      callbacks.onSave({
        ...phase,
        name: document.getElementById("phase-name").value.trim(),
        description: document.getElementById("phase-desc").value.trim(),
        state: phase.state === "manually_authored" ? "manually_authored" : "edited",
      });
    });
    document.getElementById("btn-phase-delete").addEventListener("click", () =>
      callbacks.onDelete && callbacks.onDelete(phase.phase_id));
    document.getElementById("btn-phase-split").addEventListener("click", () =>
      callbacks.onSplit && callbacks.onSplit(phase.phase_id));
  }

  /* Muted phase palette -- very low chroma. Phases sit beneath the step
     row so the tint must stay quiet to not overpower the step bands. */
  const PHASE_PALETTE = ["#5A7488","#6E6A88","#886A78","#887A5A","#5A8870","#787058"];

  function pickTickIntervalMs(totalMs, targetCount) {
    const ladder = [1000, 5000, 10000, 30000, 60000, 5 * 60000, 15 * 60000,
                    30 * 60000, 60 * 60000, 2 * 60 * 60000, 6 * 60 * 60000,
                    12 * 60 * 60000, 24 * 60 * 60000];
    const target = totalMs / Math.max(1, targetCount);
    for (const step of ladder) if (step >= target) return step;
    return ladder[ladder.length - 1];
  }
  function fmtAxisLabel(date, intervalMs) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return intervalMs < 60000 ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  }

  function renderPhaseTimeline(host, phases, steps, span, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!phases || !phases.length || !span || span.endMs <= span.startMs) return;
    const total = span.endMs - span.startMs;
    const zoom = Math.max(1, opts.zoom || 1);
    host.style.width = (100 * zoom) + "%";

    // Phases rarely overlap, but lane-pack to handle the case where
    // they do (e.g. analyst grouped overlapping step sets).
    const phaseRanges = [];
    for (const p of phases) {
      const contained = (p.step_ids || []).map(sid =>
        (steps || []).find(s => s.step_id === sid)).filter(Boolean);
      if (!contained.length) continue;
      const startMs = Math.min(...contained.map(s => new Date(s.time_range.start).getTime()));
      const endMs = Math.max(...contained.map(s => new Date(s.time_range.end).getTime()));
      phaseRanges.push({ p, startMs, endMs });
    }
    phaseRanges.sort((a, b) => a.startMs - b.startMs);
    const MAX_LANES = 3;
    const LANE_H = 22, LANE_GAP = 2, AXIS_H = 16;
    const laneEnds = [];
    const laneByPhase = new Map();
    for (const r of phaseRanges) {
      let lane = laneEnds.findIndex(e => e <= r.startMs);
      if (lane === -1) {
        if (laneEnds.length < MAX_LANES) { lane = laneEnds.length; laneEnds.push(r.endMs); }
        else { lane = MAX_LANES - 1; laneEnds[lane] = Math.max(laneEnds[lane], r.endMs); }
      } else { laneEnds[lane] = r.endMs; }
      laneByPhase.set(r.p.phase_id, lane);
    }
    const laneCount = Math.max(1, laneEnds.length);
    const rowsH = laneCount * (LANE_H + LANE_GAP);
    host.style.minHeight = (rowsH + AXIS_H + 4) + "px";

    // Time axis at the bottom
    const axis = document.createElement("div");
    axis.className = "tl-time-axis";
    axis.style.top = rowsH + "px";
    axis.style.height = AXIS_H + "px";
    const tickCount = Math.max(4, Math.round(10 * zoom));
    const intervalMs = pickTickIntervalMs(total, tickCount);
    const firstTick = Math.ceil(span.startMs / intervalMs) * intervalMs;
    for (let t = firstTick; t <= span.endMs; t += intervalMs) {
      const left = ((t - span.startMs) / total) * 100;
      const tick = document.createElement("div");
      tick.className = "tl-tick";
      tick.style.left = left + "%";
      const lbl = document.createElement("span");
      lbl.className = "tl-tick-label";
      lbl.textContent = fmtAxisLabel(new Date(t), intervalMs);
      tick.appendChild(lbl);
      axis.appendChild(tick);
    }
    host.appendChild(axis);

    let pi = 0;
    for (const r of phaseRanges) {
      const p = r.p;
      const left = ((r.startMs - span.startMs) / total) * 100;
      const width = Math.max(0.5, ((r.endMs - r.startMs) / total) * 100);
      const color = PHASE_PALETTE[pi++ % PHASE_PALETTE.length];
      const lane = laneByPhase.get(p.phase_id) || 0;
      const band = document.createElement("div");
      const dimmed = opts.dimmedIds && opts.dimmedIds.has(p.phase_id);
      band.className = "phase-band"
        + (opts.selectedId === p.phase_id ? " selected" : "")
        + (dimmed ? " dimmed" : "");
      band.style.left = left + "%";
      band.style.width = width + "%";
      band.style.top = (lane * (LANE_H + LANE_GAP)) + "px";
      band.style.height = LANE_H + "px";
      band.style.background = color + "14";
      band.style.borderColor = color + "44";
      band.style.color = color;
      const dur = r.endMs - r.startMs;
      const durStr = dur < 60000 ? `${Math.round(dur / 1000)}s`
        : dur < 3600000 ? `${Math.round(dur / 60000)}m`
        : `${(dur / 3600000).toFixed(1)}h`;
      band.title = `${p.name} (${p.state})\n${new Date(r.startMs).toLocaleTimeString()} · ${durStr}`;
      band.dataset.phaseId = p.phase_id;
      band.innerHTML = `<span class="phase-band-label">${escapeHtml(p.name)}</span>`;
      if (opts.onSelect) {
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          opts.onSelect(p.phase_id);
        });
      }
      host.appendChild(band);
    }
    if (opts.selectedId) {
      const sel = host.querySelector(`.phase-band[data-phase-id="${opts.selectedId}"]`);
      const scroll = host.parentElement;
      if (sel && scroll) {
        const sl = sel.offsetLeft, sw = sel.offsetWidth;
        scroll.scrollLeft = Math.max(0, sl + sw / 2 - scroll.clientWidth / 2);
      }
    }
  }

  window.PdtPhases = { renderPhaseList, renderPhaseDetail, renderPhaseTimeline };
})();
