"use strict";

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { DEFAULT_CONSENT_TEXT } = require("./consent.js");

const DEFAULTS = {
  engagement_id: "default",
  engagement_name: "Default engagement",
  worker: {
    id: process.env.USERNAME || process.env.USER || "unknown",
    /* Display name -- what the analyst sees in the viewer when more than
       one operator's recordings land in the same engagement. Defaults to
       the id; set from the Profile window. */
    name: null,
    bu: null,
    role: null,
  },
  auto_end_idle_minutes: 30,
  /* An idle stretch past auto_end_idle_minutes ends the open run (not the
     recording). When false, idle is still recorded but no run is ended by
     it. Set false for 8-hour passive recordings. */
  auto_end_on_idle: true,
  poll_interval_seconds: 5,
  idle_threshold_seconds: 60,
  process_labels: [],
  obs: {
    required: false,
    websocket_url: "ws://127.0.0.1:4455",
    websocket_password: null,
    scene_name: "Process Discovery -- Default",
    auto_create_scene: true,
  },
  hotkeys: {
    start_picker: "Control+Shift+S",
    end_innermost: "Control+Shift+E",
    manual_screenshot: "Control+Shift+P",
  },
  taxonomy_version: "v0",
  screenshots: {
    enabled: true,
    quality: 60,
    on_app_switch: true,
    on_marker_fire: true,
    on_idle_resume_minutes: 5,
    /* Multi-monitor screen selection:
         "active"  -- (default) capture the display containing the
                      currently-focused window. Follows the user.
         "primary" -- always capture the primary display.
         "all"     -- capture every connected display; one screenshot
                      system event per display, suffixed _d<id>.jpg. */
    display: "active",
  },
  interactions: {
    enabled: true,
    required: false,
    auto_restart: true,
    max_restarts_per_session: 3,
    exclude_processes: [],
    /* Forensic mode -- emit the raw UIA firehose (focus_changed,
       text_changed, per-keystroke value_changed). Default off; turn
       on only when debugging missing events or focus-tracking issues.
       Expect ~3-5x more events per session. */
    verbose: false,
    /* value_changed / range_value_changed events for one field are
       coalesced within this window (ms) -- typing emits one event with
       the final value, not one per keystroke. Passed to the recorder
       in the hello message. */
    debounce_ms: 750,
    /* §11e OCR last resort. When true, an identityless element (no
       AutomationId / Name / ClassName) has its on-screen region captured
       and OCR'd (Windows.Media.Ocr) for a text label. Default OFF -- only
       worth enabling for a known low-UIA app (legacy custom controls,
       some Java/Qt), where it trades latency on those elements for a
       recovered label. Passed to the recorder in the hello message. */
    ocr: false,
  },
  /* Worker consent gate (§11f). Default "off" -> no prompt and the manifest
     records consent.required:false, preserving the pre-feature start flow.
     Set "per_session" (prompt every start) or "once" (prompt once per worker
     + version, remembered in user-config) to gate recording on consent;
     declining aborts the start. `version` bumps invalidate a "once" ack.
     Version 2: the default text no longer promises that card numbers are
     redacted (only password fields are), so an acknowledgement of the
     version 1 text is asked again. */
  consent: {
    mode: "off",
    version: 2,
    text: DEFAULT_CONSENT_TEXT,
  },
};

function deepMerge(base, override) {
  if (!override) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(base[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { config: deepMerge(DEFAULTS, {}), sourcePath: null };
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) || {};
  return {
    config: deepMerge(DEFAULTS, parsed),
    sourcePath: path.resolve(configPath),
  };
}

function writeConfigSnapshot(folder, config) {
  const out = path.join(folder, "config.yaml");
  fs.writeFileSync(out, yaml.dump(config, { lineWidth: 100 }));
  return out;
}

/* B2: the pre-flight check run before the first event is written, so a
   recordings folder that cannot be written is told at the start rather
   than discovered after an 8-hour recording. Returns plain sentences
   (empty when all is well). The request code is not checked here: the
   default one is a setup choice, not a problem to announce at every start
   (it is set under Setup (analyst), Recording setup). */
function validateConfig(config, baseDir) {
  const problems = [];
  if (baseDir) {
    try {
      fs.accessSync(baseDir, fs.constants.W_OK);
    } catch (_) {
      problems.push("The recordings folder cannot be written to: " + baseDir);
    }
  }
  return problems;
}

module.exports = { DEFAULTS, loadConfig, writeConfigSnapshot, deepMerge, validateConfig };
