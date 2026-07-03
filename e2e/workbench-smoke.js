"use strict";
/*
 * Match workbench e2e smoke (APPROACHABILITY-REDESIGN §5 R2).
 *
 * Launches the REAL viewer pre-pointed at the committed demo session and a TEMP
 * vocab dir holding one hand-built vocab whose scope + signatures MATCH some of
 * the demo's captured Salesforce controls, leave others UNNAMED, and include one
 * never-matching entry (a fixture-injected DEAD RULE). Asserts the workbench:
 *
 *   - the coverage header renders WITH a number;
 *   - the three evidence lists render with plausible counts (MATCHED > 0 on the
 *     demo, UNNAMED holds the worklist, DEAD RULES lists the injected entry);
 *   - "Name…" on an UNNAMED row opens the derivation flow with the rule editor
 *     drawer, the fresh row pre-filled with the derived signature;
 *   - naming that control and saving moves it OUT of UNNAMED after the
 *     re-analyze CTA is exercised.
 *
 * Writes ONLY into its own temp dirs; the committed demo is copied to TEMP
 * (never mutated). Exits non-zero on any regression. Mirrors vocab-smoke.js.
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

// A vocab scoped to the demo's Salesforce (chrome) windows:
//   - "Customer ID field" (Edit) + "Search" (Button) MATCH captured controls;
//   - "Product code" / "Quantity" / … are left UNNAMED (the worklist);
//   - "Nuke everything" is a fixture DEAD RULE — it matches nothing.
const SEED = {
  app_vocabulary: {
    id: "sf-workbench-e2e", name: "SF Workbench E2E", version: 1,
    scope: { window_title_regex: ".*Salesforce.*" },
    screens: [
      { id: "lookup", name: "Account lookup", window_title_regex: ".*Account lookup.*" },
    ],
    interactions: [
      { signature: { control_type: "Edit", name: "Customer ID field" }, name: "Customer ID" },
      { signature: { control_type: "Button", name: "Search" }, name: "Search customers" },
      { signature: { control_type: "Button", name: "Nuke everything (never observed)" }, name: "Dead rule fixture" },
    ],
  },
};

(async () => {
  const vocabDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-wb-vocab-"));
  fs.writeFileSync(path.join(vocabDir, "sf-workbench-e2e.yaml"), yaml.dump(SEED), "utf-8");

  // Copy the committed, already-analyzed demo into TEMP (never mutate committed
  // data). Files only — the workbench reads events.jsonl.
  const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
  const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-wb-sess-"));
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

  // Open the App Library tab and select the seeded vocab → the workbench.
  let opened = false;
  try {
    await page.waitForSelector('.tab[data-view="vocabularies"]', { state: "visible", timeout: 15000 });
    await page.click('.tab[data-view="vocabularies"]');
    await page.waitForSelector("#vocab-list .vocab-row", { state: "visible", timeout: 8000 });
    opened = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".vocab-row")];
      const r = rows.find((x) => (x.querySelector(".vocab-row-name")?.textContent || "").trim() === "SF Workbench E2E");
      if (r) { r.click(); return true; }
      return false;
    });
  } catch (_) { opened = false; }
  record("App Library opens and the seeded vocab selects into the workbench", opened,
    opened ? "" : "could not find/select the 'SF Workbench E2E' row");
  if (!opened) { await shot(page, "fail-wb-open.png"); await app.close().catch(() => {}); process.exit(1); }
  await wait(1000);

  // ---- Coverage header + the three lists ---------------------------------
  const wb = await page.evaluate(() => {
    const line = document.querySelector("#wb-coverage-line");
    const countOf = (key) => {
      const det = document.querySelector('.wb-list[data-wb-list="' + key + '"] .wb-list-count');
      return det ? parseInt((det.textContent || "0").trim(), 10) : null;
    };
    const hasNumber = !!(line && /\d/.test(line.textContent || ""));
    return {
      headerPresent: !!line,
      headerText: line ? (line.textContent || "").trim() : null,
      hasNumber,
      unnamed: countOf("unnamed"),
      matched: countOf("matched"),
      dead: countOf("dead"),
      screens: countOf("screens"),
      barWidth: (document.querySelector(".wb-coverage-fill") || {}).style
        ? document.querySelector(".wb-coverage-fill").style.width : null,
    };
  }).catch((e) => ({ err: e.message }));
  record("coverage header renders with a number", !!(wb && wb.headerPresent && wb.hasNumber),
    JSON.stringify({ text: wb && wb.headerText }));
  record("MATCHED list shows > 0 (the demo has matching controls)",
    !!(wb && typeof wb.matched === "number" && wb.matched > 0), "matched=" + (wb && wb.matched));
  record("UNNAMED worklist renders with rows (in-scope, un-named controls)",
    !!(wb && typeof wb.unnamed === "number" && wb.unnamed > 0), "unnamed=" + (wb && wb.unnamed));
  record("DEAD RULES lists the fixture-injected never-matching entry",
    !!(wb && typeof wb.dead === "number" && wb.dead >= 1), "dead=" + (wb && wb.dead));
  record("the DEAD RULE names the injected fixture entry", await page.evaluate(() => {
    const el = [...document.querySelectorAll('.wb-list[data-wb-list="dead"] .wb-dead-name')];
    return el.some((e) => /Dead rule fixture/.test(e.textContent || ""));
  }).catch(() => false), "");
  await shot(page, "workbench-default.png");

  // ---- Expand a MATCHED row (Evidence one click behind the claim) ---------
  const matchedEv = await page.evaluate(() => {
    const det = document.querySelector('.wb-list[data-wb-list="matched"] details.wb-row-matched');
    if (!det) return { row: false };
    det.open = true;
    return {
      row: true,
      name: (det.querySelector(".wb-match-name") || {}).textContent || null,
      hasEvidence: !!det.querySelector(".wb-evidence"),
      hasWindow: !!det.querySelector(".wb-ev-win"),
      hasSig: !!det.querySelector(".wb-ev-sig"),
    };
  }).catch((e) => ({ err: e.message }));
  record("a MATCHED row expands to show evidence (windows seen in + rule signature)",
    !!(matchedEv && matchedEv.row && matchedEv.hasEvidence && matchedEv.hasWindow && matchedEv.hasSig),
    JSON.stringify(matchedEv));
  await shot(page, "workbench-matched-expanded.png");

  // ---- "Name…" on an UNNAMED row → derivation flow, pre-filled ------------
  // Capture the pre-name UNNAMED count + the identity of the first row.
  const before = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.wb-list[data-wb-list="unnamed"] .wb-row-unnamed')];
    const first = rows[0];
    return {
      unnamedCount: rows.length,
      firstIdentity: first ? (first.querySelector(".wb-idval") || {}).textContent : null,
    };
  }).catch((e) => ({ err: e.message }));

  // Click "Name…" on the first UNNAMED row (there IS a selection rule: the
  // first row of the worklist, which is the most-used un-named control).
  const nameClicked = await page.evaluate(() => {
    const btn = document.querySelector('.wb-list[data-wb-list="unnamed"] .wb-name-btn[data-wb-name]');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
  await wait(700);
  // The rule editor drawer should now be open with a fresh row pre-filled with
  // the derived signature (control_type + name/aid — NOT typed by hand).
  const derived = await page.evaluate((wantIdentity) => {
    const drawer = document.querySelector(".vocab-machine-drawer");
    const rows = [...document.querySelectorAll("#vocab-interactions .vocab-int")];
    // The newly-added row is the LAST one (appended). Its signature inputs must
    // be pre-populated (derived), and its name field empty/awaiting the analyst.
    const last = rows[rows.length - 1];
    let sig = {};
    if (last) {
      last.querySelectorAll("[data-sig]").forEach((el) => { if (el.value) sig[el.dataset.sig] = el.value; });
    }
    return {
      drawerOpen: !!(drawer && drawer.open),
      rowCount: rows.length,
      derivedSig: sig,
      hasDerivedSig: Object.keys(sig).length > 0,
    };
  }, before && before.firstIdentity).catch((e) => ({ err: e.message }));
  record("'Name…' on an UNNAMED row opens the derivation flow with a pre-filled signature",
    !!(nameClicked && derived && derived.drawerOpen && derived.hasDerivedSig),
    JSON.stringify({ clicked: nameClicked, sig: derived && derived.derivedSig }));
  await shot(page, "workbench-name-flow.png");

  // Type the business name into the fresh row, then Save the vocabulary.
  const namedOk = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#vocab-interactions .vocab-int")];
    const last = rows[rows.length - 1];
    const nameInput = last && last.querySelector('[data-field="name"]');
    if (!nameInput) return false;
    nameInput.value = "Named in workbench e2e";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }).catch(() => false);
  record("the analyst can type a business name into the derived row", namedOk, "");
  await page.click("#btn-vocab-save").catch((e) => console.log("save", e.message));
  await wait(1200);

  // ---- Exercise the re-analyze CTA, then confirm the control left UNNAMED --
  // The workbench recomputes advisory matches immediately from the in-memory
  // vocab too; but the spec wants the re-analyze CTA exercised. Stub any confirm
  // (there is none here — no confirmed steps) and click the CTA.
  const reCta = await page.evaluate(() => {
    const b = document.querySelector("#btn-wb-reanalyze");
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  record("the re-analyze CTA ('apply names to this session') exists and is clickable", reCta, "");
  // The CTA drives #btn-normalize (re-run pipeline + reload). Give it time; it
  // spawns the bundled Python. Poll for the workbench to re-render.
  await wait(1500);
  // Re-open the App Library tab in case the re-analyze reload switched focus.
  await page.click('.tab[data-view="vocabularies"]').catch(() => {});
  await wait(1500);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".vocab-row")];
    const r = rows.find((x) => (x.querySelector(".vocab-row-name")?.textContent || "").trim() === "SF Workbench E2E");
    if (r) r.click();
  }).catch(() => {});
  // Wait for either the normalize to settle or a generous cap.
  let after = null;
  for (let i = 0; i < 40; i++) {
    after = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.wb-list[data-wb-list="unnamed"] .wb-row-unnamed')];
      const matched = document.querySelector('.wb-list[data-wb-list="matched"] .wb-list-count');
      return {
        unnamedCount: rows.length,
        matchedCount: matched ? parseInt((matched.textContent || "0").trim(), 10) : null,
        busy: !!(document.querySelector("#btn-normalize") && document.querySelector("#btn-normalize").disabled),
      };
    }).catch(() => null);
    if (after && !after.busy && typeof after.unnamedCount === "number") break;
    await wait(500);
  }
  record("after naming + re-analyze, the named control leaves UNNAMED (count drops)",
    !!(before && after && typeof before.unnamedCount === "number" &&
       typeof after.unnamedCount === "number" && after.unnamedCount < before.unnamedCount),
    "unnamed before=" + (before && before.unnamedCount) + " after=" + (after && after.unnamedCount) +
    " matched after=" + (after && after.matchedCount));
  await shot(page, "workbench-after-name.png");

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-wb-page-errors.png");

  await app.close().catch(() => {});
  try { fs.rmSync(vocabDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(sessDir, { recursive: true, force: true }); } catch (_) {}

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n[workbench-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[workbench-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[workbench-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
