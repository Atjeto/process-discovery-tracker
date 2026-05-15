"use strict";

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const DEFAULTS = {
  engagement_id: "default",
  engagement_name: "Default engagement",
  worker: {
    id: process.env.USERNAME || process.env.USER || "unknown",
    bu: null,
    role: null,
  },
  auto_end_idle_minutes: 30,
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
    sync_marker: "Control+Shift+Y",
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

module.exports = { DEFAULTS, loadConfig, writeConfigSnapshot, deepMerge };
