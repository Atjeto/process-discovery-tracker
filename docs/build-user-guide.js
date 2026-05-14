/*
 * Generates the User Guide as User-Guide.docx using docx-js.
 *
 * Style constraint: NO em-dashes or en-dashes anywhere in the doc.
 * Use regular hyphens or rephrase. Verified during text composition.
 *
 * Run from repo root:
 *   node docs/build-user-guide.js
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const docxPath = path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "docx"
);
const docx = fs.existsSync(docxPath) ? require(docxPath) : require("docx");

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber, PageBreak,
  Bookmark, InternalHyperlink, TableOfContents,
} = docx;

/* ===== Style helpers =============================================== */

const FONT = "Calibri";
const COL_FG = "1F2328";
const COL_FG_2 = "57606A";
const COL_ACCENT = "4B6B47";
const COL_RULE = "D0D7DE";
const COL_HEADER_BG = "F1F3F5";

const border = (color) => ({
  style: BorderStyle.SINGLE, size: 4, color,
});
const cellBorders = {
  top: border(COL_RULE), bottom: border(COL_RULE),
  left: border(COL_RULE), right: border(COL_RULE),
};
const cellMargins = { top: 100, bottom: 100, left: 160, right: 160 };

function p(text, opts) {
  opts = opts || {};
  return new Paragraph({
    spacing: { after: opts.after == null ? 120 : opts.after, before: opts.before || 0 },
    alignment: opts.alignment,
    children: [new TextRun({
      text,
      bold: !!opts.bold,
      italics: !!opts.italics,
      size: opts.size || 22,
      color: opts.color || COL_FG,
      font: FONT,
    })],
  });
}

function bullet(text, level) {
  return new Paragraph({
    numbering: { reference: "bullets", level: level || 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, color: COL_FG, font: FONT })],
  });
}

function numbered(text) {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, color: COL_FG, font: FONT })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    pageBreakBefore: true,
    children: [new TextRun({ text, size: 36, bold: true, color: COL_FG, font: FONT })],
  });
}

function h1NoBreak(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, size: 36, bold: true, color: COL_FG, font: FONT })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, size: 28, bold: true, color: COL_FG, font: FONT })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 },
    children: [new TextRun({ text, size: 24, bold: true, color: COL_ACCENT, font: FONT })],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { after: 120, before: 60 },
    shading: { fill: COL_HEADER_BG, type: ShadingType.CLEAR },
    children: [new TextRun({ text, font: "Consolas", size: 20, color: COL_FG })],
  });
}

function note(text) {
  return new Paragraph({
    spacing: { after: 160 },
    shading: { fill: "FFF8E1", type: ShadingType.CLEAR },
    indent: { left: 200, right: 200 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: "B49A7E", space: 8 },
    },
    children: [
      new TextRun({ text: "Note: ", bold: true, size: 22, color: COL_FG, font: FONT }),
      new TextRun({ text, size: 22, color: COL_FG, font: FONT }),
    ],
  });
}

/* ===== Tables ====================================================== */

function tableCell(text, opts) {
  opts = opts || {};
  return new TableCell({
    borders: cellBorders,
    margins: cellMargins,
    width: { size: opts.width || 4680, type: WidthType.DXA },
    shading: opts.shading
      ? { fill: opts.shading, type: ShadingType.CLEAR }
      : undefined,
    children: [
      new Paragraph({
        spacing: { after: 0 },
        children: [new TextRun({
          text: text || "",
          bold: !!opts.bold,
          size: 20,
          color: COL_FG,
          font: opts.mono ? "Consolas" : FONT,
        })],
      }),
    ],
  });
}

function buildTable(rows, widths) {
  const totalW = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell, ci) =>
          tableCell(
            typeof cell === "string" ? cell : cell.text,
            {
              width: widths[ci],
              bold: ri === 0,
              shading: ri === 0 ? COL_HEADER_BG : undefined,
              mono: typeof cell === "object" && cell.mono,
            }
          )
        ),
      })
    ),
  });
}

/* ===== Document content ============================================ */

const content = [];

/* Title page */
content.push(
  new Paragraph({
    spacing: { before: 2000, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "Process Discovery Tracker", size: 56, bold: true, color: COL_FG, font: FONT,
    })],
  }),
  new Paragraph({
    spacing: { after: 600 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "User Guide", size: 40, color: COL_ACCENT, font: FONT,
    })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "Capture, mine, and synthesize process discovery sessions",
      size: 22, italics: true, color: COL_FG_2, font: FONT,
    })],
  }),
  new Paragraph({
    spacing: { before: 800, after: 120 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "Version 0.1 (Draft)", size: 20, color: COL_FG_2, font: FONT,
    })],
  }),
  new Paragraph({
    spacing: { after: 120 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "Internal tool for the automation and business application team",
      size: 20, color: COL_FG_2, font: FONT,
    })],
  }),
);

/* Table of contents */
content.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    pageBreakBefore: true,
    children: [new TextRun({ text: "Contents", size: 36, bold: true, color: COL_FG, font: FONT })],
  }),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-3" }),
);

/* 1. Introduction */
content.push(
  h1("1. Introduction"),
  h2("What this tool is"),
  p("The Process Discovery Tracker is an internal tool that replaces the manual stopwatch and screenshot workflow used during process discovery sessions. It produces an instrumented capture of an SME walkthrough or full-shift review, then turns the raw capture into XES event logs, BPMN process maps, and aggregate statistics suitable for automation candidate analysis."),
  p("It is not a product. Workers run it because their leadership has assigned them to a review. The design optimizes for analyst throughput, not opt-in worker UX."),
  h2("Architecture at a glance"),
  p("The system has three executables that share a single integration seam (the session package folder):"),
  bullet("Capture: an Electron tray app that runs on the worker machine. Polls the foreground window every 5 seconds, fires marker events on hotkey or tray, optionally drives OBS to record the screen, and writes per-session JSONL."),
  bullet("Normalization: a Python service that turns raw events into XES, CSV, statistics, and (optionally) a mined BPMN map. Runs on the analyst's machine."),
  bullet("Viewer: an Electron app for the analyst. Two surfaces in one window. Session view for one-session deep dives with video synced to the timeline. Aggregate view for cross-session synthesis, mining, and exports."),
  h2("Three target use cases"),
  buildTable([
    ["Use case", "Profile", "Primary output"],
    ["Walkthrough (PM with SME)", "30 to 90 minutes per session, explicit Start and End markers, OBS recording is the visual record", "Annotated session timeline, draft process map, basis for a Process Definition Document"],
    ["IE shift review", "Full 4 to 8 hour shift, possibly multiple machines, sparse or no markers", "Aggregate statistics, waste and idle analysis, automation candidate list"],
    ["Post-automation validation", "Same SME and process after the bot ships", "Before and after comparison: duration, frequency, manual-step count"],
  ], [2200, 3500, 3500]),
);

/* 2. Installation */
content.push(
  h1("2. Installation"),
  p("All three components are installed once, then reused across engagements."),
  h2("2.1 Capture (worker machine)"),
  p("Requirements: Windows 10 or 11. No admin install is required. OBS Studio is required only if you intend to record screens during the session."),
  numbered("Copy the packaged capture folder to a known location, for example C:\\Tools\\PDT\\capture\\."),
  numbered("Optional but recommended: install OBS Studio (free) from obsproject.com. Enable the WebSocket server inside OBS via Tools, WebSocket Server Settings."),
  numbered("Optional: create a Start Menu shortcut to the capture executable, or pin the tray app to the taskbar after launch."),
  note("During development from source, run `npm install` inside the capture/ folder once. The packaged build (electron-builder output) requires no install steps on the target machine."),
  h2("2.2 Normalization (analyst machine)"),
  p("Requirements: Python 3.10 or later. The viewer can spawn Python automatically once it is on PATH or pointed to via PDT_PYTHON."),
  numbered("Open a terminal in the normalization/ folder."),
  numbered("Run the install command:"),
  code("pip install -r requirements.txt"),
  p("This installs PM4Py (for mining), pandas, networkx, PyYAML, and supporting packages."),
  note("Corporate IT lockdown: if pip is blocked from reaching PyPI, ask your IT to mirror the wheels in an internal repository, or use the python-embeddable folder shipped alongside the viewer (planned ship target). See section 11."),
  h2("2.3 Viewer (analyst machine)"),
  p("Requirements: Windows 10 or 11. The packaged viewer is a self-contained Electron app."),
  numbered("Copy the packaged viewer folder to a known location, for example C:\\Tools\\PDT\\viewer\\."),
  numbered("Make sure either the normalization/ folder is a sibling of viewer/, OR the viewer is configured to find Python with the normalization scripts. The viewer searches in this order: PDT_PYTHON env var, then a sibling python-embeddable/ folder, then system python on PATH."),
  numbered("Launch the viewer (Process Discovery Viewer.exe in a packaged build, or `npm start` in dev)."),
);

/* 3. Configuration */
content.push(
  h1("3. Configuration"),
  p("Configuration is split into two layers with different ownership."),
  h2("3.1 Central taxonomy"),
  p("The taxonomy is the team-wide classification reference. It maps application executables and window-title patterns to activity labels (for example, chrome.exe with title matching .*Salesforce.* becomes CRM - Salesforce). It is maintained centrally, version-controlled, and improves over time."),
  p("File location: normalization/sample-taxonomy.yaml in the repository. Copy this file, customize it, and store the master copy wherever your team keeps shared configuration (typically a Git repository)."),
  p("Rule shape:"),
  code(`- match:
    app: "chrome.exe"
    title_regex: ".*Salesforce.*"
  label: "CRM - Salesforce"
  extract:
    transaction_id: "Case #(\\d+)"`),
  p("Rules evaluate in order, first match wins. Events with no matching rule receive a fallback label that preserves the raw signals (Unclassified - chrome.exe) so the analyst can correct them later."),
  p("The taxonomy is owned by the automation team lead. New rules are added in batch when the viewer surfaces patterns the analyst is correcting manually."),
  h2("3.2 Per-session configuration"),
  p("Per-session configuration is the small engagement-specific metadata that varies per review. It is a YAML file pointed at via the PDT_CONFIG environment variable before launching capture."),
  p("Set PDT_CONFIG in PowerShell:"),
  code(`$env:PDT_CONFIG = "C:\\engagements\\demo-2026-05\\config.yaml"
& "C:\\Tools\\PDT\\capture\\Process Discovery Tracker.exe"`),
  p("Or via a shortcut: right-click the shortcut, Properties, Target field, prepend cmd /c \"set PDT_CONFIG=... && ...\"."),
  p("Per-session config fields:"),
  buildTable([
    ["Field", "Purpose", "Default"],
    ["engagement_id", "Identifier for the engagement; used in the session folder path", "default"],
    ["engagement_name", "Human-readable name", "Default engagement"],
    ["worker.id, worker.bu, worker.role", "Stamped into XES org:resource", "USERNAME from env"],
    ["auto_end_idle_minutes", "Auto-close open markers after this much idle time", "30"],
    ["poll_interval_seconds", "Active-window polling cadence (rarely changed)", "5"],
    ["idle_threshold_seconds", "Idle is detected when no input for this many seconds", "60"],
    ["process_labels", "List of preconfigured labels for the tray menu and label picker", "five generic labels"],
    ["obs.required", "If true, capture refuses to start when OBS is unreachable", "false"],
    ["obs.websocket_url, websocket_password", "OBS WebSocket connection details", "ws://127.0.0.1:4455, no auth"],
    ["obs.scene_name, auto_create_scene", "Scene to load; bootstrap automatically", "Process Discovery - Default, true"],
    ["hotkeys.start_picker, end_innermost, manual_screenshot", "Global hotkeys", "Ctrl+Shift+S, E, P"],
    ["taxonomy_version", "Stamped into output for re-runnability", "v0"],
    ["screenshots.enabled, quality, on_app_switch, on_marker_fire, on_idle_resume_minutes", "Screenshot triggers and JPEG quality", "enabled, q=60, switch and marker on, resume after 5 min"],
  ], [3000, 4500, 2200]),
  p("A complete annotated example ships at capture/sample-config.yaml. Copy it as a starting point for each engagement."),
  h2("3.3 Taxonomy versioning"),
  p("The taxonomy_version field is captured into manifest.json and stats.json. When the central taxonomy is updated, past sessions can be re-normalized against the new version. Raw events are unchanged; only classification and case stamps are recomputed."),
);

/* 4. OBS Setup */
content.push(
  h1("4. OBS Setup"),
  p("OBS Studio is the screen recording layer. The capture tracker controls it programmatically. Video files are then moved alongside the rest of the session package using your existing OBS workflow (no new transport is introduced)."),
  h2("4.1 One-time OBS configuration"),
  numbered("Install OBS Studio (version 28 or later). Most teams already use a recent version."),
  numbered("Inside OBS, open Tools, WebSocket Server Settings."),
  numbered("Tick Enable WebSocket server. Leave the port at 4455 unless you have a reason to change it."),
  numbered("If you want authentication, set a password here and copy it into your per-session config.yaml under obs.websocket_password. Otherwise leave Authentication disabled for ease of use on internal machines."),
  numbered("Click OK. OBS does not need to be restarted."),
  h2("4.2 First-run scene bootstrap"),
  p("When the capture tracker connects to OBS for the first time, it programmatically creates a scene (default name: Process Discovery - Default) with a timestamp overlay browser source. This overlay shows the current time on every recorded frame at 10 Hz refresh, giving you three benefits:"),
  bullet("A human-readable reference when reviewing the video later"),
  bullet("Sync verification: the burned-in clock can be compared to the tracker event stream to catch drift"),
  bullet("OCR fallback: if the obs-websocket handshake fails, the timestamp can be recovered from the video frame"),
  p("This bootstrap is idempotent. If the scene already exists, the tracker just switches to it."),
  h2("4.3 What happens during recording"),
  p("When the capture session starts (and OBS is reachable), the tracker:"),
  bullet("Loads the configured scene"),
  bullet("Issues StartRecord via the WebSocket"),
  bullet("Captures both the tracker-side and OBS-side start timestamps and computes an offset in milliseconds"),
  bullet("Writes those values to obs/sync.json inside the session folder"),
  p("This sync data is what allows the viewer to map a tracker event timestamp directly to a video seek position."),
  h2("4.4 If OBS is not available"),
  p("Set obs.required to false in your per-session config. The session will run without video; the timeline will still capture activity events and markers. Click-to-seek in the viewer will be a no-op but everything else works."),
);

/* 5. Running a session */
content.push(
  h1("5. Running a Capture Session"),
  h2("5.1 Before you start"),
  bullet("Have your per-session config.yaml ready (or accept the defaults for ad-hoc testing)"),
  bullet("Launch OBS if you plan to record video"),
  bullet("Coordinate with the SME on the start time and the process labels they will walk through"),
  h2("5.2 Launch"),
  numbered("Set the PDT_CONFIG environment variable to point to your config.yaml (skip if using defaults)."),
  numbered("Launch the capture tray app. A tray icon appears in the system tray near the clock."),
  numbered("Right-click the tray icon to see the menu."),
  numbered("Click Start capture session. The status line in the menu changes to Tracking, with the marker depth and active app."),
  numbered("Open the live status window: Show status window in the tray menu. This gives you a 340-pixel-wide dashboard with the recording indicator, session timer, current app, open marker stack, counters, and quick action buttons."),
  h2("5.3 Firing markers"),
  p("Markers bracket business activities. There are three ways to fire a Start marker:"),
  bullet("Hotkey (default Ctrl+Shift+S): opens a Spotlight-style label picker. Type to filter the configured labels, or type any free-form label, then press Enter."),
  bullet("Tray menu, Fire Start marker: same picker as the hotkey."),
  bullet("Tray menu, Quick start submenu: pre-configured labels fire immediately without opening the picker."),
  p("End markers (default Ctrl+Shift+E or tray menu Fire End marker) close the innermost open marker. There is no label to choose; end always pairs with the most recent unmatched start."),
  p("Markers can nest. Start Customer onboarding, then within it Start Identity check, Start Credit check, and so on. Each transaction is a child case of the parent process case."),
  h2("5.4 Screenshots"),
  p("Screenshots fire automatically on these triggers (configurable per-session):"),
  bullet("App switch: when the foreground app changes between polls"),
  bullet("Marker fire: on every Start or End"),
  bullet("Idle resume: when the worker comes back after a long idle period (default 5 minutes)"),
  p("You can also press Ctrl+Shift+P at any time for a manual screenshot. These are flagged as screenshot_manual in the event stream so the analyst can find them quickly."),
  h2("5.5 Pausing"),
  p("If the worker needs to handle a personal matter or step into a private call, pause the polling from the tray menu or the status window. While paused, the tracker emits a `paused` system event and stops polling. Resume fires a `resumed` event and continues."),
  p("Important: pausing does not pause OBS. If you also want to pause the video recording, do that separately inside OBS."),
  h2("5.6 Ending the session"),
  numbered("Right-click the tray icon, click End capture session. (Or use the End session button in the status window.)"),
  numbered("The tracker closes the in-flight activity event, fires session_end, stops OBS recording (if connected), and writes the final manifest."),
  numbered("A confirmation dialog shows the session folder path. The folder is now portable and ready to move to the analyst's machine."),
  h2("5.7 If the tracker crashes mid-session"),
  p("On the next launch, the tracker detects orphan sessions (a session folder with status active but no clean session_end). The orphan manifest is marked status: recovered. The events.jsonl file is preserved up to the last flush (typically within the past second; per-event append is the default). Open markers remain in the stream for normalization to reconcile."),
);

/* 6. Reviewing in the viewer */
content.push(
  h1("6. Reviewing a Session"),
  p("The viewer is where the analyst spends most of their time. It runs on the analyst's machine, independent of the capture machine."),
  h2("6.1 Open a session"),
  numbered("Launch the viewer."),
  numbered("On the Session view (Tab 1, or press 1), click Open session folder."),
  numbered("Navigate to the session folder, select it, click OK."),
  numbered("The view populates: pills at the top show event count, status, OBS link, normalization state. Video appears if linked. Timeline renders below."),
  p("Recently opened sessions are remembered across launches and shown on the empty state for one-click reload."),
  h2("6.2 Run normalization"),
  p("Click Run normalization. The viewer spawns python normalize.py against the session folder. If you tick Mine BPMN + DFG (recommended), it also runs the PM4Py inductive miner and emits process_map.bpmn and dfg.json."),
  p("Outputs land alongside events.jsonl: events.xes, events.csv, stats.json, plus process_map.bpmn and dfg.json if mining was enabled. The Normalization log section at the bottom shows the live output."),
  h2("6.3 The timeline"),
  p("The timeline renders all session events along a horizontal axis. From top to bottom:"),
  bullet("Activity bands (green): one band per foreground app run. Width is proportional to duration. Hover for the exact app, title, and span."),
  bullet("Idle bands (grey): derived from idle_start and idle_end system events."),
  bullet("Marker bars (orange): vertical lines at every Start and End. Start markers get a label chip."),
  bullet("Screenshot dots (blue): a small circle at every screenshot capture. Click to seek the video to that moment."),
  bullet("Case overlays (bottom band): horizontal regions showing the span of each case, with nesting indentation."),
  p("Click anywhere on the timeline to seek the video. Use the zoom controls (+ and - buttons at the top-right of the timeline, or keys + - 0) for finer scrubbing. The white vertical playhead follows video playback."),
  h2("6.4 Annotations sidebar"),
  p("The right column has three tabs:"),
  bullet("Notes: free-text observations anchored to the current playback time. Click any saved note to seek back to it."),
  bullet("Screenshots: thumbnail grid of all captured screenshots. Click a thumbnail to seek; the manual badge marks screenshots fired with Ctrl+Shift+P."),
  bullet("Markers: full list of markers with depth indicator. Click any row to seek. Double-click a Start marker to rename it."),
  p("Renames are saved to annotations.json under marker_edits. They appear immediately in the timeline label and in the markers list. Re-run normalization to push the renamed label into XES, CSV, and stats."),
  h2("6.5 Raw events table"),
  p("At the bottom of the Session view, the collapsible Raw events section shows the full event stream as a sortable table. Use the filter input to search by app, label, or kind. Type checkboxes (activity, marker, system) let you hide categories you do not care about. Click any row to seek the video."),
  h2("6.6 Reading the session pills"),
  p("The pills at the top of the loaded view summarize session state at a glance:"),
  buildTable([
    ["Pill", "What it means"],
    ["events", "Total event count in the session (any type)"],
    ["status", "Manifest status: closed (clean), recovered (crashed), or active (still running on another instance)"],
    ["OBS", "linked if a recording is referenced in the manifest, none otherwise"],
    ["normalized", "Check mark if stats.json exists for this session"],
    ["taxonomy", "Version of the taxonomy this session was normalized against"],
    ["edits", "Number of pending annotation edits not yet applied to normalization output"],
  ], [2400, 6800]),
);

/* 7. Aggregate analysis */
content.push(
  h1("7. Aggregate Analysis"),
  p("The Aggregate view (Tab 2, or press 2) is where you combine multiple sessions into mined process maps and cross-session statistics. Use it for IE shift reviews, post-automation validation comparisons, and multi-walkthrough syntheses."),
  h2("7.1 Loading sessions"),
  numbered("Click Open sessions. You can multi-select session folders, or pick a parent engagement folder; the viewer auto-expands engagement folders into their child sessions."),
  numbered("The pills at the top show how many sessions were loaded and how many are already normalized."),
  numbered("Click Normalize + mine all to run the full pipeline (with mining) across every loaded session. Progress shows in the log panel."),
  h2("7.2 The process map"),
  p("The Process Map panel has two tabs:"),
  bullet("BPMN: the inductive miner output rendered as a proper BPMN diagram via bpmn-js. Pan with the mouse, scroll to zoom."),
  bullet("DFG: the Directly-Follows Graph laid out automatically with dagre. Edge thickness scales with frequency. Green-bordered nodes are start activities, orange-bordered nodes are end activities. Click any node to drill back to the first session containing that activity, at the matching timestamp."),
  h2("7.3 Statistics"),
  p("The statistics panels populate from stats.json across all loaded sessions:"),
  buildTable([
    ["Panel", "Contents", "Source"],
    ["Activity frequency", "Top 12 activities by frequency. Bar shows count, label includes total duration.", "merged across sessions"],
    ["Case durations", "Top 12 cases ranked by active duration. Thin overlay shows wall-clock duration so you can spot heavy-idle cases.", "top-level cases only"],
    ["Trace variants", "Distinct activity sequences ranked by frequency. Top 80.", "per-case label sequences"],
    ["App outliers", "Apps that appear in less than 5% of cases. Useful for spotting exceptions or unauthorized tools.", "case-level app frequency"],
    ["Rework loops", "Activities revisited within a single case. Indicates back-and-forth or correction patterns.", "intra-case activity counts"],
  ], [2400, 5400, 2400]),
  h2("7.4 Filtering"),
  p("The search box in the actions bar filters all statistics panels simultaneously by substring match. Type SAP to see only SAP-related activities, cases, variants, and outliers. Clear the box to remove the filter."),
);

/* 8. Exports */
content.push(
  h1("8. Exports"),
  p("Every artifact the viewer produces is also a file on disk inside the session folder. The export buttons in the Aggregate view simply copy the appropriate file to a destination of your choice."),
  buildTable([
    ["Export", "File", "When to use"],
    ["BPMN 2.0 XML", "process_map.bpmn (per session)", "Import directly into Adonis or any BPMN-aware tool. Edit positioning, gateways, and pool/lane structure there."],
    ["XES", "events.xes (per session)", "Open in PM4Py, Apromore, Disco, ProM, Celonis, or any process mining tool that accepts XES."],
    ["stats.json", "stats.json (per session)", "Reproducible inspection of the same statistics shown in the viewer. Diff between sessions, archive snapshots, or feed into downstream reporting."],
  ], [2200, 3200, 4800]),
  p("Additional artifacts that do not have an explicit export button but are easy to copy from the session folder:"),
  bullet("events.csv: flat CSV of activity events for Excel inspection"),
  bullet("dfg.json: directly-follows graph as raw edges with frequencies, for custom tooling"),
  bullet("Screenshots in the screenshots/ subfolder"),
  bullet("annotations.json with the analyst's notes and marker edits"),
);

/* 9. Annotations */
content.push(
  h1("9. Annotations and Re-normalization"),
  p("Annotations let the analyst correct or enrich a session without modifying the raw event stream. They live in annotations.json inside the session folder."),
  h2("9.1 What can be annotated"),
  buildTable([
    ["Annotation", "Saved as", "Effect"],
    ["Free-text note at a timestamp", "notes[]", "Surfaced in the Notes sub-tab; click to seek"],
    ["Marker label rename", "marker_edits[] with field=label", "Renames the marker in the viewer; consumed by re-normalization to update XES, CSV, and stats"],
  ], [3200, 3000, 4000]),
  p("Marker boundary adjustment, merge, split, and other edits are designed but not yet wired in v1. The annotation file shape already supports them; future viewer versions will expose the UI."),
  h2("9.2 The re-normalization contract"),
  p("Raw events.jsonl is immutable. Annotation edits are applied as a derived layer during normalization, before case assignment. If the taxonomy is updated, or the analyst makes new edits, re-run normalization to refresh the downstream artifacts."),
  p("The number of edits applied per run is recorded in the meta block of stats.json under marker_edits_applied so you can audit what changed."),
);

/* 10. Keyboard shortcuts */
content.push(
  h1("10. Keyboard Shortcuts"),
  h2("Viewer"),
  buildTable([
    ["Keys", "Action"],
    ["1", "Switch to Session view"],
    ["2", "Switch to Aggregate view"],
    ["?", "Open the in-app help modal"],
    ["Esc", "Close the help modal"],
    ["Space", "Play or pause the video"],
    ["Left arrow, Right arrow", "Scrub the video by 5 seconds"],
    ["Shift + Left arrow, Shift + Right arrow", "Scrub the video by 10 seconds"],
    ["+ / -", "Zoom the timeline in or out"],
    ["0", "Reset timeline zoom"],
  ], [4000, 5360]),
  h2("Capture (default global hotkeys, overridable in config)"),
  buildTable([
    ["Keys", "Action"],
    ["Ctrl + Shift + S", "Open the Start-marker label picker (also auto-starts a session if none is running)"],
    ["Ctrl + Shift + E", "Fire End marker for the innermost open marker"],
    ["Ctrl + Shift + P", "Manual screenshot, flagged as screenshot_manual"],
  ], [3200, 6160]),
);

/* 11. Install topology */
content.push(
  h1("11. Install Topology and Corporate IT"),
  p("The runtime footprint is split asymmetrically across worker and analyst machines. Both halves must fit corporate IT lockdown: no admin install, no PyPI access at runtime, no unflagged binaries."),
  h2("11.1 Worker machine"),
  p("The capture tracker ships as a single packaged Electron .exe via electron-builder. There are no post-install steps. The only worker-side prerequisite is OBS Studio (which the team already standardizes on). The tracker runs from a folder, no admin rights are required to launch."),
  h2("11.2 Analyst machine"),
  p("Python is generally available on corporate machines, but PM4Py and its dependency stack (numpy, pandas, networkx, graphviz) are not standard packages. Three install paths are supported:"),
  buildTable([
    ["Option", "Description", "Recommended for"],
    ["python-embeddable folder shipped alongside the viewer", "Zip of Python plus preloaded site-packages including PM4Py. No installer, no PATH change, no registry writes. Pattern used by Anki and Calibre.", "Production deployments. Default ship target."],
    ["PyInstaller bundle into Electron resources", "Python plus PM4Py packed into the viewer's resources folder. Ships as one app folder.", "Tighter integration when packaging is centralized."],
    ["Corporate-channel install of dependencies", "IT mirrors the needed wheels in an internal repository, analysts run pip install pointing at that mirror.", "When the team has an established internal package repo."],
  ], [3000, 4500, 2200]),
  p("In all paths, the analyst should not be asked to run pip install pm4py against PyPI directly. Network access to PyPI is often blocked, and the install state is implicit."),
  h2("11.3 Telling the viewer which Python to use"),
  p("The viewer resolves the Python interpreter in this order:"),
  numbered("PDT_PYTHON environment variable, if set and the path exists"),
  numbered("A sibling python-embeddable/ folder next to the viewer executable"),
  numbered("System python on PATH"),
);

/* 12. Troubleshooting */
content.push(
  h1("12. Troubleshooting"),
  h2("Capture"),
  buildTable([
    ["Symptom", "Likely cause and fix"],
    ["Tray icon never appears", "Single-instance lock from a previous launch, or antivirus blocking the executable. Enable PDT_DEBUG=1 and check %APPDATA%\\process-discovery-tracker\\boot.log."],
    ["Hotkey did not register", "Another app holds the same global shortcut. Check boot.log for hotkeys: start=false. Edit your config.yaml to use different keys."],
    ["OBS will not connect", "OBS not running, or WebSocket server not enabled, or wrong port/password. Verify Tools, WebSocket Server Settings in OBS. Set obs.required=false to proceed without OBS."],
    ["Session shows as recovered on next launch", "Previous session ended without a clean close. Open markers stay in events.jsonl for normalization to reconcile. Not an error."],
    ["Screenshots not firing", "Check that screenshots.enabled is true in your config. The screenshot library spawns a helper exe on first run, which can take 2 to 3 seconds."],
    ["Where does my data go", "%APPDATA%\\process-discovery-tracker\\sessions\\ on Windows. The tray menu has an Open sessions folder item."],
  ], [3200, 6160]),
  h2("Normalization"),
  buildTable([
    ["Symptom", "Likely cause and fix"],
    ["ModuleNotFoundError: pm4py", "Run pip install -r requirements.txt against the interpreter the viewer uses, or set PDT_PYTHON to a Python with the deps installed."],
    ["XES export fails with warnings", "Some marker streams produce events the XES exporter cannot reconcile. The CSV output is still emitted. Check the log for the specific error."],
    ["Adonis import does not work cleanly", "PM4Py BPMN can be imperfect for high-variance processes. Edit the file in Adonis or post-process it. If this becomes blocking, switch the export path."],
  ], [3200, 6160]),
  h2("Viewer"),
  buildTable([
    ["Symptom", "Likely cause and fix"],
    ["normalize.py not found", "The viewer expects normalization/ as a sibling of viewer/. In a packaged build, normalization should be under resources/normalization/."],
    ["BPMN map shows bpmn-js failed to load", "Library load issue. The .bpmn file is still on disk and importable into Adonis directly."],
    ["No video in Session view", "Capture ran without OBS, or the OBS recording path in manifest.json is unreachable. Timeline still works; click-to-seek is a no-op."],
    ["Empty event table", "Check the type checkboxes (activity, marker, system) and clear the filter text."],
    ["Drill-down landed on wrong moment", "DFG drill uses a heuristic on app and title. For exact precision, click directly on the timeline."],
  ], [3200, 6160]),
);

/* 13. Appendix */
content.push(
  h1("13. Appendix: File Formats"),
  p("This is a reference for analysts and developers who need to consume the captured data without going through the viewer."),
  h2("13.1 Session folder layout"),
  code(`sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/
  events.jsonl        # raw event stream, one JSON object per line
  manifest.json       # session metadata, status, OBS reference
  config.yaml         # snapshot of per-session config
  screenshots/        # event-triggered captures
  obs/sync.json       # tracker to OBS clock-sync data (if OBS connected)
  # After normalization:
  events.xes          # IEEE 1849-2016 event log
  events.csv          # flat CSV mirror
  stats.json          # statistics + meta block
  process_map.bpmn    # BPMN 2.0 XML (with --mine)
  dfg.json            # directly-follows graph (with --mine)
  annotations.json    # analyst notes and marker edits`),
  h2("13.2 Event envelope"),
  p("Every event in events.jsonl follows the same shape:"),
  code(`{
  "event_id": "uuid",
  "type": "activity" | "marker" | "system",
  "timestamp": "2026-05-14T09:23:11.482Z",
  "session_id": "uuid",
  "data": { ... type-specific ... }
}`),
  h2("13.3 Type-specific data fields"),
  buildTable([
    ["Type", "Fields"],
    ["activity", "app, title, pid, duration_ms"],
    ["marker", "marker_type (start or end), label, reason (optional, e.g. auto_end_idle); case_id and parent_case_id added by normalization"],
    ["system", "kind (one of session_start, session_end, paused, resumed, idle_start, idle_end, auto_end_idle, screenshot, screenshot_manual, obs_recording_start, obs_recording_stop) plus kind-specific payload"],
  ], [1800, 7560]),
  h2("13.4 stats.json meta block"),
  p("The meta block in stats.json records what produced the stats:"),
  bullet("normalization_run_at: ISO 8601 timestamp"),
  bullet("taxonomy_version: from the taxonomy YAML"),
  bullet("taxonomy_path: absolute path of the taxonomy file used"),
  bullet("session_folder: absolute path of the input"),
  bullet("worker_id: from per-session config"),
  bullet("raw_event_count, collapsed_activity_count, case_count: pipeline counters"),
  bullet("annotations_present: boolean"),
  bullet("marker_edits_applied: count of annotation overrides consumed"),
);

/* ===== Build document ============================================== */

const doc = new Document({
  creator: "Process Discovery Tracker",
  title: "Process Discovery Tracker - User Guide",
  description: "Onboarding and user guide for the internal Process Discovery Tracker tool.",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
        quickFormat: true,
        run: { size: 36, bold: true, font: FONT, color: COL_FG },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal",
        quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: COL_FG },
        paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal",
        quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: COL_ACCENT },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "◦",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ],
      },
      {
        reference: "numbers",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({
            text: "Process Discovery Tracker - User Guide",
            size: 18, color: COL_FG_2, font: FONT,
          })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Page ", size: 18, color: COL_FG_2, font: FONT }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: COL_FG_2, font: FONT }),
            new TextRun({ text: " of ", size: 18, color: COL_FG_2, font: FONT }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: COL_FG_2, font: FONT }),
          ],
        })],
      }),
    },
    children: content,
  }],
});

const outPath = path.join(__dirname, "User-Guide.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("Wrote " + outPath + " (" + buf.length + " bytes)");
});
