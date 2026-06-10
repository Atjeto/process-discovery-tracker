/*
 * Close-out wizard window (lab-phase §E3) -- the worker-facing wrap-up
 * shown when a capture session ends:
 *
 *   1. up to 5 observed-value questions (wizard.js over observe.js
 *      facts), answers appended to annotations.json self_annotations[];
 *   2. the review handover -- a read-only summary (facts + the worker's
 *      own marked steps) with an explicit "Submit session" button that
 *      stamps manifest.worker_review (worker agency as the consent
 *      feature; closing without submitting withholds the stamp).
 *
 * Mirrors consent-window.js mechanics: single window, IPC scoped to this
 * window's webContents, resolves once on close. All disk writes go
 * through persist.js (electron-free, unit-tested).
 */

"use strict";

const path = require("node:path");
const { BrowserWindow, ipcMain } = require("electron");
const { generateQuestions, buildSelfAnnotation } = require("./wizard.js");
const { observeSessionFolder } = require("./observe.js");
const { writeSelfAnnotations, stampWorkerReview } = require("./persist.js");
const { bootLog } = require("../boot-log.js");

function fmtDur(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

function fmtClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_) { return ""; }
}

function fmtMins(ms) {
  const m = Math.round((ms || 0) / 60000);
  return m >= 1 ? `${m}m` : `${Math.round((ms || 0) / 1000)}s`;
}

/* The read-only review payload: session facts + the worker's own step
   list. Steps = the start markers they fired; with no markers, the top
   focus stretches stand in (titled honestly as where the time went). */
function buildReviewSummary(observations, summary) {
  const facts = [
    ["Duration", fmtDur(summary && summary.durationMs)],
    ["Events", String((summary && summary.events) != null ? summary.events : observations.counts.events)],
    ["Interactions", String((summary && summary.interactions) != null ? summary.interactions : observations.counts.interactions)],
    ["Markers fired", String((summary && summary.markers) != null ? summary.markers : observations.counts.markers)],
    ["Screenshots", String((summary && summary.screenshots) != null ? summary.screenshots : observations.counts.screenshots)],
  ];
  if (summary && summary.hadVideo != null) {
    facts.push(["Video", summary.hadVideo ? "recorded" : "not recorded"]);
  }
  const topApps = observations.apps.slice(0, 3)
    .map((a) => `${a.app} ${fmtMins(a.ms)}`).join("  ·  ");
  if (topApps) facts.push(["Top apps", topApps]);

  const startMarkers = observations.markers.filter((m) => m.marker_type === "start");
  if (startMarkers.length) {
    return {
      facts,
      stepsTitle: "The steps you marked",
      steps: startMarkers.map((m) => ({
        label: m.label || "(unlabeled)",
        time: fmtClock(m.timestamp),
      })),
    };
  }
  return {
    facts,
    stepsTitle: "Where the time went (no markers were fired)",
    steps: observations.focus_stretches
      .slice()
      .sort((a, b) => b.dur_ms - a.dur_ms)
      .slice(0, 5)
      .map((s) => ({ label: s.app, time: fmtMins(s.dur_ms) })),
  };
}

/*
 * Show the close-out wizard for a just-ended session. Resolves
 * { asked, answered, submitted } when the window closes; never rejects
 * (close-out problems must not break session end -- they are logged).
 */
function showCloseoutWizard({ sessionFolder, summary }) {
  return new Promise((resolve) => {
    let observations;
    let questions;
    try {
      observations = observeSessionFolder(sessionFolder);
      questions = generateQuestions({ capture_observations: observations });
    } catch (e) {
      bootLog(`closeout: observation failed: ${e && e.message}`);
      resolve({ asked: 0, answered: 0, submitted: false });
      return;
    }
    const review = buildReviewSummary(observations, summary);

    const win = new BrowserWindow({
      width: 560,
      height: 560,
      title: "Wrap up your session",
      resizable: true,
      autoHideMenuBar: true,
      backgroundColor: "#14141A",
      skipTaskbar: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        spellcheck: false,
      },
    });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());

    const wcId = win.webContents.id;
    let answered = 0;
    let submitted = false;
    let settled = false;

    function onLoad(event) {
      if (event.sender.id !== wcId) return undefined;
      return { questions, summary: review };
    }
    function onAnswers(event, answers) {
      if (event.sender.id !== wcId) return 0;
      const entries = (Array.isArray(answers) ? answers : [])
        .map((a) => buildSelfAnnotation(a.question, a.answer, a.is_exception));
      answered = entries.length;
      try { return writeSelfAnnotations(sessionFolder, entries); }
      catch (e) {
        bootLog(`closeout: self_annotations write failed: ${e && e.message}`);
        return 0;
      }
    }
    function onSubmitSession(event) {
      if (event.sender.id !== wcId) return false;
      try {
        submitted = stampWorkerReview(sessionFolder, {
          questionsAsked: questions.length,
          questionsAnswered: answered,
        });
      } catch (e) {
        bootLog(`closeout: worker_review stamp failed: ${e && e.message}`);
      }
      return submitted;
    }

    /* handle() throws on a duplicate channel -- clear any stale handler
       from an abnormally-closed previous wizard first. */
    for (const ch of ["pdt-wizard:load", "pdt-wizard:answers", "pdt-wizard:submitSession"]) {
      try { ipcMain.removeHandler(ch); } catch (_) {}
    }
    ipcMain.handle("pdt-wizard:load", onLoad);
    ipcMain.handle("pdt-wizard:answers", onAnswers);
    ipcMain.handle("pdt-wizard:submitSession", onSubmitSession);

    win.on("closed", () => {
      if (settled) return;
      settled = true;
      for (const ch of ["pdt-wizard:load", "pdt-wizard:answers", "pdt-wizard:submitSession"]) {
        try { ipcMain.removeHandler(ch); } catch (_) {}
      }
      bootLog(`closeout: ${questions.length} asked, ${answered} answered, submitted=${submitted}`);
      resolve({ asked: questions.length, answered, submitted });
    });

    win.loadFile(path.join(__dirname, "wizard-window.html"));
  });
}

module.exports = { showCloseoutWizard, buildReviewSummary };
