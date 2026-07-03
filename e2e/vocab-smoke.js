"use strict";
/*
 * App Library (vocab editor) e2e smoke — the ADR-0025 discovery-enrichment pin
 * + the lab-phase §C2/§C3/§C4 pins.
 *
 * Successor scope to session-smoke.js, focused on the App Library editor. It
 * launches the REAL viewer pre-pointed at a TEMP vocab dir (PDT_APP_VOCABULARIES)
 * holding one freshly-"discovered" entry whose only signature is a weak
 * class_name — the exact shape that, pre-fix, rendered as a blank "(unset
 * signature)" row and was ERASED to `{}` on save. It then asserts:
 *
 *   - the row is legible, not blank: the signature summary shows the class_name,
 *     the annotator-context chips (role / region / framework) render, the
 *     ancestry + the honest weak-signature note render, and the over-merge
 *     members disclosure lists the distinct controls that collapsed together;
 *   - the chips/labels are not clipped (scrollWidth <= clientWidth);
 *   - the retired review checklist (R1 App Library pass): a loaded discovered
 *     row carries NO "reviewed" tick, progress counter, or Approve-all — naming
 *     a candidate IS the review — but the auto-filled semantics (verb pre-set
 *     from the control role, carries_value pre-ticked) still arrive on the row;
 *   - §C3: "Copy for LLM…" opens the line-by-line review modal whose textarea
 *     is ONE parseable JSON carrying the vocab skeleton rows (row_key + verb),
 *     and the suggestions import path exists alongside it;
 *   - §C4: setting the data posture to `sealed` REMOVES both LLM buttons from
 *     the DOM (not hides); back to `reviewable` restores them;
 *   - the load-bearing fix: after Save, the on-disk YAML still carries
 *     `signature.class_name` (no longer nuked), the analyst-facing fields survive
 *     (seen_count + the §C1 semantics verb/carries_value), and the discovery-meta
 *     (role / framework / region / ancestry / _members / confidence / _reviewed)
 *     is stripped so the persisted vocab stays clean.
 *
 * Writes ONLY into its own temp dir; touches no committed data. Exits non-zero
 * on any regression so CI can gate on it. Reuses the viewer's Electron + js-yaml.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const OUT = __dirname;
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const yaml = require(path.join(VIEWER, "node_modules", "js-yaml"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}

// R2: open the demoted rule-editor Machine drawer so its form fields drive.
async function openRuleEditor(page) {
  return await page.evaluate(() => {
    const det = document.querySelector(".vocab-machine-drawer");
    if (!det) return false;
    if (!det.open) {
      det.open = true;
      det.dispatchEvent(new Event("toggle"));  // persist _ruleEditorOpen
    }
    return !!document.querySelector("#vocab-interactions");
  }).catch(() => false);
}

// One "discovered" entry whose only signature is a weak class_name, plus the
// enrichment the picker now stamps (the post-discovery editor state). Two members
// at DISTINCT regions == the over-merge the annotator must be able to see.
// The second row is the §C2 shape: a discovered Edit field whose autofill
// (verb=enter, carries_value=true — what bootstrap_from_snapshot derives for an
// Edit role) must arrive pre-filled in the editor's review checklist.
const SEED = {
  app_vocabulary: {
    id: "spotify-e2e", name: "Spotify E2E", version: 1,
    scope: { window_title_regex: ".*Spotify E2E.*" },
    screens: [{ id: "spotify-e2e", name: "Spotify E2E" }],
    interactions: [
      {
        signature: { class_name: "x-btn" },
        name: "",
        identity_source: "class_name", confidence: 0.4, seen_count: 2,
        role: "button", framework: "chromium", region: "bottom-left",
        ancestry: ["Window", "Pane"],
        _members: [
          { role: "button", region: "bottom-left", under: ["Window", "Pane"] },
          { role: "button", region: "bottom-right", under: ["Window", "Pane"] },
        ],
        screen: "spotify-e2e",
      },
      {
        signature: { control_type: "Edit", automation_id: "order-id" },
        name: "Order ID",
        verb: "enter", carries_value: true,
        identity_source: "automation_id", confidence: 0.95, seen_count: 1,
        role: "edit", framework: "chromium", region: "top-left",
        screen: "spotify-e2e",
      },
    ],
  },
};

(async () => {
  const vocabDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-vocab-e2e-"));
  const seedPath = path.join(vocabDir, "spotify-e2e.yaml");
  fs.writeFileSync(seedPath, yaml.dump(SEED), "utf-8");

  // A loadable session, so the G-7 bootstrap (default = the open session) and
  // the G-8 Steps right-click flow can run. Copy the committed, already-analyzed
  // demo into TEMP — never mutate committed data (CLAUDE.md). Files only; the
  // Steps interaction list needs events.jsonl + annotations.json, not the
  // screenshots/process_maps subdirs.
  const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
  const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-vocab-sess-"));
  for (const f of fs.readdirSync(SRC_SESSION)) {
    const s = path.join(SRC_SESSION, f);
    try { if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(sessDir, f)); } catch (_) {}
  }

  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [".", "--session=" + sessDir],
      cwd: VIEWER,
      env: Object.assign({}, process.env, { PDT_APP_VOCABULARIES: vocabDir }),
    });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  // Open the App Library tab and select the seeded vocab.
  let opened = false;
  try {
    await page.waitForSelector('.tab[data-view="vocabularies"]', { state: "visible", timeout: 15000 });
    await page.click('.tab[data-view="vocabularies"]');
    await page.waitForSelector("#vocab-list .vocab-row", { state: "visible", timeout: 8000 });
    opened = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".vocab-row")];
      const r = rows.find((x) => (x.querySelector(".vocab-row-name")?.textContent || "").trim() === "Spotify E2E");
      if (r) { r.click(); return true; }
      return false;
    });
  } catch (_) { opened = false; }
  record("App Library tab opens and the seeded vocab is listed + selectable", opened,
    opened ? "" : "could not find/select the 'Spotify E2E' row");
  if (!opened) { await shot(page, "fail-vocab-open.png"); await app.close().catch(() => {}); process.exit(1); }
  await wait(1000); // editor render

  // R2: with a session loaded, selecting a vocab opens the MATCH WORKBENCH by
  // default; the blank-form rule editor is demoted to a Machine drawer
  // (.vocab-machine-drawer). This smoke drives the rule editor's form fields, so
  // open that drawer first. Opening it persists (_ruleEditorOpen) across the
  // re-renders below (Approve-all, add-interaction, G-7 skeleton, save), so this
  // single open keeps #vocab-interactions reachable for every later check.
  const drawerOpened = await openRuleEditor(page);
  record("R2: the rule editor Machine drawer opens under the workbench", drawerOpened,
    drawerOpened ? "" : "could not open .vocab-machine-drawer");
  // R2: the workbench renders its resident coverage header for (session × vocab).
  const wbHeader = await page.evaluate(() => {
    const line = document.querySelector("#wb-coverage-line");
    return { present: !!line, text: line ? (line.textContent || "").trim() : null };
  }).catch((e) => ({ err: e.message }));
  record("R2: the workbench coverage header renders", !!(wbHeader && wbHeader.present),
    JSON.stringify(wbHeader));
  await shot(page, "vocab-workbench-default.png");

  // Probe the rendered interaction row.
  const ui = await page.evaluate(() => {
    const row = document.querySelector("#vocab-interactions .vocab-int");
    if (!row) return { row: false };
    const sig = (row.querySelector(".vocab-int-sig")?.textContent || "").trim();
    const cnInput = row.querySelector('input[data-sig="class_name"]');
    const chips = [...row.querySelectorAll(".vocab-int-chip")].map((c) => (c.textContent || "").trim());
    // Clipping check (CLAUDE.md: validate label rendering): no chip/summary/note
    // may overflow its box.
    const clip = [];
    row.querySelectorAll(".vocab-int-chip, .vocab-int-sig, .vocab-int-members > summary").forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) clip.push((el.textContent || "").trim().slice(0, 24));
    });
    return {
      row: true,
      sig,
      hasClassInput: !!cnInput,
      classValue: cnInput ? cnInput.value : null,
      chips,
      hasWeakNote: !!row.querySelector(".vocab-int-weak-note"),
      hasMembers: !!row.querySelector(".vocab-int-members"),
      memberItems: row.querySelectorAll(".vocab-int-members li").length,
      clipped: clip,
    };
  }).catch((e) => ({ err: e.message }));

  if (ui.err || !ui.row) {
    record("discovered row renders", false, ui.err || "no .vocab-int row");
    await shot(page, "fail-vocab-row.png");
  } else {
    record("class_name signature is shown, not '(unset signature)'",
      ui.sig.includes("x-btn") && !/unset signature/.test(ui.sig), "summary='" + ui.sig + "'");
    record("class_name is an editable, populated field (survives the round-trip)",
      ui.hasClassInput && ui.classValue === "x-btn", "value='" + ui.classValue + "'");
    record("annotator-context chips render (role / region / framework)",
      ui.chips.includes("button") && ui.chips.includes("bottom-left") && ui.chips.includes("chromium"),
      "chips=[" + ui.chips.join(", ") + "]");
    record("honest weak-signature note renders", ui.hasWeakNote, ui.hasWeakNote ? "" : "no .vocab-int-weak-note");
    record("over-merge members disclosure lists the distinct collapsed controls",
      ui.hasMembers && ui.memberItems === 2, "memberItems=" + ui.memberItems);
    record("row labels/chips are not clipped", ui.clipped.length === 0,
      ui.clipped.length ? "clipped: " + ui.clipped.join(", ") : "all fit");
    if (results.some((r) => !r.ok)) await shot(page, "fail-vocab-render.png");
  }
  await shot(page, "vocab-enriched-row.png");

  // ---- Item 17 (R1 rename): the raw signature block is a per-row "Raw match
  // rule" disclosure, COLLAPSED by default on EVERY row (manual surgery only —
  // the human's default path names controls in the workbench, never here). Its
  // inputs stay reachable via [data-sig] for collectAndMark() regardless.
  const sigDisclosure = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#vocab-interactions .vocab-int")];
    return rows.map((r) => {
      const det = r.querySelector(".vocab-int-sig-details");
      const sum = det && det.querySelector("summary");
      return {
        hasDetails: !!det,
        open: !!(det && det.open),
        summary: sum ? (sum.textContent || "").trim() : null,
        sigInputCount: r.querySelectorAll(".vocab-int-sig-fields [data-sig]").length,
      };
    });
  }).catch((e) => ([{ err: e.message }]));
  record("item 17: every row's raw signature block is behind a COLLAPSED 'Raw match rule' disclosure",
    sigDisclosure.length === 2 &&
      sigDisclosure.every((r) => r.hasDetails && !r.open && r.sigInputCount === 5 && /Raw match rule/.test(r.summary || "")),
    JSON.stringify(sigDisclosure));
  // A freshly hand-added row (+ Add interaction) is likewise COLLAPSED.
  await page.click("#btn-vocab-add-interaction").catch((e) => console.log("add-interaction", e.message));
  await wait(300);
  const newRowDisclosure = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#vocab-interactions .vocab-int")];
    const last = rows[rows.length - 1];
    const det = last && last.querySelector(".vocab-int-sig-details");
    return { hasDetails: !!det, open: !!(det && det.open), sigInputCount: last ? last.querySelectorAll(".vocab-int-sig-fields [data-sig]").length : 0 };
  }).catch((e) => ({ err: e.message }));
  record("item 17: a hand-added row's raw signature block starts COLLAPSED",
    !!(newRowDisclosure && newRowDisclosure.hasDetails && !newRowDisclosure.open && newRowDisclosure.sigInputCount === 5),
    JSON.stringify(newRowDisclosure));
  // Undo the manual add so it doesn't leak into the later row-count assertions.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#vocab-interactions .vocab-int-remove")];
    const last = rows[rows.length - 1];
    if (last) last.click();
  });
  await wait(300);

  // ---- The retired review checklist + surviving auto-filled semantics ------
  // R1 App Library pass: naming a candidate IS the review, so a loaded
  // discovered row carries NO "reviewed" tick / progress / Approve-all. The
  // auto-derived semantics (verb/carries_value) still arrive on the row.
  const checklist = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#vocab-interactions .vocab-int")];
    const row2 = rows.find((r) => {
      const aid = r.querySelector('input[data-sig="automation_id"]');
      return aid && aid.value === "order-id";
    });
    let verb = null, carries = null, completion = null;
    if (row2) {
      const v = row2.querySelector('select[data-sem="verb"]');
      const c = row2.querySelector('input[data-semflag="carries_value"]');
      const f = row2.querySelector('input[data-semflag="completion"]');
      verb = v ? v.value : null;
      carries = c ? c.checked : null;
      completion = f ? f.checked : null;
    }
    return {
      rows: rows.length,
      reviewTicks: document.querySelectorAll("#vocab-interactions [data-review]").length,
      progressGone: !document.querySelector("#vocab-review-progress"),
      approveAllGone: !document.querySelector("#btn-vocab-approve-all"),
      verb, carries, completion,
    };
  }).catch((e) => ({ err: e.message }));
  record("retired review checklist: NO per-row ticks, NO progress counter, NO Approve-all",
    !!(checklist && !checklist.err && checklist.rows === 2 && checklist.reviewTicks === 0 &&
      checklist.progressGone && checklist.approveAllGone),
    JSON.stringify(checklist));
  record("auto-filled semantics still arrive pre-set (verb=enter, carries_value ticked, completion not)",
    !!(checklist && checklist.verb === "enter" && checklist.carries === true && checklist.completion === false),
    "verb=" + (checklist && checklist.verb) + " carries=" + (checklist && checklist.carries) +
    " completion=" + (checklist && checklist.completion));
  await shot(page, "vocab-discovered-row.png");

  // ---- §C3: Copy for LLM — review modal, one parseable derived-only JSON ---
  const llmBtns = await page.evaluate(() => ({
    copy: document.querySelectorAll("#btn-vocab-copy-llm").length,
    imp: document.querySelectorAll("#btn-vocab-import-llm").length,
  })).catch((e) => ({ err: e.message }));
  record("§C3: Copy-for-LLM + Import-suggestions buttons render under the default (reviewable) posture",
    !!(llmBtns && llmBtns.copy === 1 && llmBtns.imp === 1), JSON.stringify(llmBtns));

  await page.click("#btn-vocab-copy-llm").catch((e) => console.log("copy-llm", e.message));
  await wait(400);
  const exportProbe = await page.evaluate(() => {
    const ta = document.querySelector(".llm-export-modal .llm-export-text");
    if (!ta) return { modal: false };
    let doc = null, parseErr = null;
    try { doc = JSON.parse(ta.value); } catch (e) { parseErr = e.message; }
    const root = doc && doc.pdt_copy_for_llm;
    const rows = (root && root.vocabularies && root.vocabularies[0] && root.vocabularies[0].rows) || [];
    // G-5 v2: row keys are namespaced `<vocab_id>|<signature key>` so one
    // export can carry several apps' rows without key collisions.
    const row = rows.find((r) => r.row_key === "spotify-e2e|aid|order-id");
    return {
      modal: true, parseErr,
      posture: root && root.data_posture,
      hasInstructions: !!(root && root.how_to_respond && root.how_to_respond.response_shape),
      rowCount: rows.length,
      rowVerb: row && row.verb,
      noEvents: !ta.value.includes('"events"') && !/"value":/.test(ta.value),
    };
  }).catch((e) => ({ err: e.message }));
  record("§C3: the export modal opens with ONE parseable JSON (line-by-line reviewable)",
    !!(exportProbe && exportProbe.modal && !exportProbe.parseErr && exportProbe.posture === "reviewable"),
    JSON.stringify({ modal: exportProbe && exportProbe.modal, parseErr: exportProbe && exportProbe.parseErr, posture: exportProbe && exportProbe.posture }));
  record("§C3: skeleton rows carry row_key + the auto verb, plus the response contract",
    !!(exportProbe && exportProbe.rowCount === 2 && exportProbe.rowVerb === "enter" && exportProbe.hasInstructions),
    "rows=" + (exportProbe && exportProbe.rowCount) + " verb=" + (exportProbe && exportProbe.rowVerb));
  record("§C3: no raw-event shapes in the export (no events block, no raw value keys)",
    !!(exportProbe && exportProbe.noEvents), "");
  await shot(page, "vocab-llm-export-modal.png");
  await page.keyboard.press("Escape").catch(() => {});
  await wait(250);

  // ---- §C4: sealed posture REMOVES the LLM surface from the DOM -----------
  const sealed = await page.evaluate(() => {
    require("./posture.js").setDataPosture("sealed");
    return {
      copy: document.querySelectorAll("#btn-vocab-copy-llm").length,
      imp: document.querySelectorAll("#btn-vocab-import-llm").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("§C4: sealed posture removes both LLM buttons from the DOM (not just hides)",
    !!(sealed && !sealed.err && sealed.copy === 0 && sealed.imp === 0), JSON.stringify(sealed));
  const restored = await page.evaluate(() => {
    require("./posture.js").setDataPosture("reviewable");
    return { copy: document.querySelectorAll("#btn-vocab-copy-llm").length };
  }).catch((e) => ({ err: e.message }));
  record("§C4: switching back to reviewable restores the button (the inverse)",
    !!(restored && restored.copy === 1), JSON.stringify(restored));

  // The load-bearing fix: Save, then the on-disk YAML must still carry class_name.
  // #btn-vocab-save lives in the (possibly collapsed) Machine drawer — ensure open.
  await page.evaluate(() => {
    const det = document.querySelector(".vocab-machine-drawer");
    if (det && !det.open) { det.open = true; det.dispatchEvent(new Event("toggle")); }
    const btn = document.querySelector("#btn-vocab-save");
    if (btn) btn.click();
  }).catch((e) => console.log("save", e.message));
  await wait(1200);
  let saved = null;
  try { saved = yaml.load(fs.readFileSync(seedPath, "utf-8")); } catch (e) { saved = { _err: e.message }; }
  const e0 = saved && saved.app_vocabulary && (saved.app_vocabulary.interactions || [])[0];
  record("after Save, signature.class_name SURVIVES on disk (the data-loss fix)",
    !!(e0 && e0.signature && e0.signature.class_name === "x-btn"),
    "saved signature=" + JSON.stringify(e0 && e0.signature));
  record("after Save, seen_count (analyst-facing) is preserved",
    !!(e0 && e0.seen_count === 2), "seen_count=" + (e0 && e0.seen_count));
  record("after Save, discovery-meta is stripped (clean persisted vocab)",
    !!(e0 && !("role" in e0) && !("_members" in e0) && !("confidence" in e0) && !("region" in e0)),
    "leftover keys=" + (e0 ? Object.keys(e0).filter((k) => ["role", "framework", "region", "ancestry", "_members", "confidence", "identity_source"].includes(k)).join(",") || "(none)" : "?"));
  // §C1: the semantics SURVIVE the save (they are data, not meta). The retired
  // review tick (_reviewed) stays in the strip list so an OLD vocab carrying it
  // still saves clean; provenance (identity_source/confidence) is stripped.
  const e1 = saved && saved.app_vocabulary && (saved.app_vocabulary.interactions || [])[1];
  record("after Save, the §C1 semantics persist on disk (verb=enter, carries_value=true)",
    !!(e1 && e1.verb === "enter" && e1.carries_value === true &&
      e1.signature && e1.signature.automation_id === "order-id"),
    "row2=" + JSON.stringify(e1 && { verb: e1.verb, carries_value: e1.carries_value, signature: e1.signature }));
  record("after Save, the retired review tick (_reviewed) + provenance are stripped from row 2",
    !!(e1 && !("_reviewed" in e1) && !("identity_source" in e1) && !("confidence" in e1)),
    e1 ? "leftover=" + (Object.keys(e1).filter((k) => ["_reviewed", "identity_source", "confidence"].includes(k)).join(",") || "(none)") : "?");

  // =====================================================================
  // G-7: "Start from a recording" → per-app picker → CANDIDATE worklist
  // =====================================================================
  // Stub the save dialog so the new app's vocab file lands in our temp dir.
  // We pick SAPGUI from the recording: its id ("sapgui") is NOT one of the
  // shipped vocabs, so it takes the clean NEW-vocab path — every control arrives
  // as an UNNAMED candidate to name (R1 App Library pass; no review checklist).
  // (chrome/excel/outlook collide with shipped vocabs and would exercise the
  // merge-into-existing path instead.)
  const newVocabPath = path.join(vocabDir, "sapgui-from-rec.yaml");
  await app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: fp });
  }, newVocabPath);
  await page.click('.tab[data-view="vocabularies"]').catch(() => {});
  await wait(300);
  await page.click("#btn-vocab-bootstrap-session").catch((e) => console.log("bootstrap click", e.message));
  let pickerUp = false;
  try {
    await page.waitForSelector(".modal-picker input[name='picker-choice']", { state: "visible", timeout: 30000 });
    pickerUp = true;
  } catch (_) { pickerUp = false; }
  const pickerProbe = pickerUp ? await page.evaluate(() => {
    const clip = [];
    const btn = document.querySelector("#btn-vocab-bootstrap-session");
    if (btn && btn.scrollWidth > btn.clientWidth + 1) clip.push("button:" + (btn.textContent || "").trim());
    document.querySelectorAll(".modal-picker .modal-check span, .modal-picker .modal-ok").forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) clip.push((el.textContent || "").trim().slice(0, 24));
    });
    return {
      count: document.querySelectorAll(".modal-picker input[name='picker-choice']").length,
      labels: [...document.querySelectorAll(".modal-picker .modal-check span")].map((s) => (s.textContent || "").trim()).slice(0, 8),
      clipped: clip,
    };
  }) : { count: 0, labels: [], clipped: [] };
  record("G-7: 'Start from a recording' offers one starter per observed app",
    pickerUp && pickerProbe.count >= 3, "apps offered: [" + pickerProbe.labels.join(", ") + "]");
  record("G-7: the new button + picker option labels are not clipped",
    pickerUp && pickerProbe.clipped.length === 0,
    pickerProbe.clipped.length ? "clipped: " + pickerProbe.clipped.join(", ") : "all fit");
  await shot(page, "vocab-bootstrap-picker.png");
  // Choose SAPGUI (a clean, no-prior-vocab app) before confirming.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".modal-picker .modal-check")]
      .find((l) => /SAPGUI/.test(l.textContent || ""));
    const radio = row && row.querySelector("input[type=radio]");
    if (radio) radio.checked = true;
  });
  await page.click(".modal-picker .modal-ok").catch((e) => console.log("picker ok", e.message));
  await wait(1600);  // newVocabFile (stubbed save) + candidate build + render
  const boot = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.wb-list[data-wb-list="candidates"] .wb-row-candidate')];
    // Candidates are NOT pushed into the persisted vocab: the rule editor should
    // have no interaction rows yet (nothing named).
    const drawerRows = document.querySelectorAll("#vocab-interactions .vocab-int").length;
    return {
      candRows: rows.length,
      hasNameBtns: [...rows].every((r) => !!r.querySelector(".wb-name-btn[data-wb-cand-name]")),
      hasIgnore: [...rows].every((r) => !!r.querySelector(".wb-cand-ignore")),
      hasIdentityLine: [...rows].every((r) => !!r.querySelector(".wb-idval")),
      drawerRows,
      noReviewTicks: document.querySelectorAll("[data-review]").length === 0,
    };
  }).catch((e) => ({ err: e.message }));
  record("G-7: the bootstrapped app opens as a CANDIDATE worklist WITH rows (name/ignore, identity line)",
    !!(boot && !boot.err && boot.candRows >= 4 && boot.hasNameBtns && boot.hasIgnore && boot.hasIdentityLine && boot.noReviewTicks),
    JSON.stringify(boot));
  record("G-7: candidates are transient — not persisted into the vocab's interactions",
    !!(boot && boot.drawerRows === 0), "drawer interaction rows=" + (boot && boot.drawerRows));
  await shot(page, "vocab-bootstrap-candidates.png");
  // The new SAPGUI vocab adopted the recording's scope (dirty). Clear dirty so
  // the G-8 selectVocab (a different vocab) doesn't hit the discard-changes
  // confirm. Candidates are transient; nothing named is lost.
  await page.evaluate(() => { require("./state.js").getVocabState().dirty = false; }).catch(() => {});
  await wait(300);

  // =====================================================================
  // G-8: right-click a step interaction → "Add to App Library…" → row added
  // =====================================================================
  await page.click('.tab[data-view="session"]').catch(() => {});
  await wait(400);
  await page.evaluate(() => {   // element grain → flat list with real interactions
    const s = document.getElementById("grain-slider");
    if (s) { s.value = "0"; s.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  await page.click('.view-mode-btn[data-level="steps"]').catch(() => {});
  await wait(800);
  let stepReady = false;
  try {
    await page.waitForSelector("#step-list .step-row", { state: "visible", timeout: 8000 });
    await page.click("#step-list .step-row");
    await page.waitForSelector("#step-detail .step-interaction[data-idx]", { state: "attached", timeout: 6000 });
    stepReady = true;
  } catch (_) { stepReady = false; }
  const stepName = stepReady
    ? await page.evaluate(() => { const n = document.querySelector("#step-name"); return n ? n.value : null; })
    : null;
  if (stepReady) {
    await page.evaluate(() => {
      const li = document.querySelector("#step-detail .step-interaction[data-idx]");
      const r = li.getBoundingClientRect();
      li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 5), clientY: Math.round(r.top + 5) }));
    });
    await page.waitForSelector("#step-ctx-menu", { state: "visible", timeout: 4000 }).catch(() => {});
  }
  const menuClicked = stepReady ? await page.evaluate(() => {
    const it = [...document.querySelectorAll("#step-ctx-menu div")]
      .find((d) => /Add to App Library/.test(d.textContent || ""));
    if (it) { it.click(); return true; }
    return false;
  }).catch(() => false) : false;
  record("G-8: right-click a step interaction offers 'Add to App Library…'", menuClicked,
    menuClicked ? "" : "no 'Add to App Library…' item in #step-ctx-menu");
  await shot(page, "vocab-add-from-step-menu.png");
  let added = null;
  if (menuClicked) {
    await page.waitForSelector(".modal-picker input[name='picker-choice']", { state: "visible", timeout: 6000 }).catch(() => {});
    await page.evaluate(() => {
      const spot = [...document.querySelectorAll(".modal-picker .modal-check")]
        .find((l) => /Spotify E2E/.test(l.textContent || ""));
      const radio = spot && spot.querySelector("input[type=radio]");
      if (radio) radio.checked = true;
    });
    await page.click(".modal-picker .modal-ok").catch(() => {});
    await wait(1300);   // activateTab(vocabularies) + selectVocab + candidate + render
    // R1 App Library pass: the step's control arrives as a CANDIDATE with its
    // INLINE name editor open (prefilled from the step name), NOT a row pushed
    // into the rule-editor drawer (naming never navigates).
    added = await page.evaluate(() => {
      const active = document.querySelector(".tab.active");
      const editing = document.querySelector('.wb-row-candidate.editing');
      const input = editing && editing.querySelector(".wb-inline-input");
      const drawerRows = document.querySelectorAll("#vocab-interactions .vocab-int").length;
      return {
        tab: active ? active.dataset.view : null,
        candOpen: !!editing,
        inlineName: input ? input.value : null,
        drawerRows,
      };
    }).catch((e) => ({ err: e.message }));
  }
  record("G-8: the step control is added as a candidate with its inline editor open in the chosen vocab",
    !!(added && !added.err && added.tab === "vocabularies" && added.candOpen), JSON.stringify(added));
  record("G-8: the inline editor's name is prefilled from the step name",
    !!(added && stepName && added.inlineName === stepName),
    "stepName='" + stepName + "' inlineName='" + (added && added.inlineName) + "'");
  await shot(page, "vocab-add-from-step-result.png");

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-vocab-page-errors.png");

  await app.close().catch(() => {});
  try { fs.rmSync(vocabDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(sessDir, { recursive: true, force: true }); } catch (_) {}

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n[vocab-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[vocab-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[vocab-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
