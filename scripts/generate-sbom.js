#!/usr/bin/env node
/*
 * SBOM generator. Produces a CycloneDX-shaped JSON listing every
 * npm dependency under capture/, viewer/, and (if the embeddable
 * Python is built) the Python site-packages in viewer/python/.
 *
 * Run from repo root:
 *     node scripts/generate-sbom.js
 *
 * Output: <repo>/dist/SBOM.json (also dumped to stdout).
 *
 * No third-party deps; pure Node stdlib so the SBOM tool itself is
 * self-evidently safe.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

/* The project version, read from a real package.json (capture and viewer are
   versioned together) rather than hardcoded. */
function readRootVersion() {
  for (const rel of ["capture/package.json", "viewer/package.json"]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf-8")).version;
      if (v) return v;
    } catch (_e) { /* try the next */ }
  }
  return "0.0.0";
}

/* The set of "<name>@<version>" npm considers a PRODUCTION dependency of an app
   (`npm ls --omit=dev`), so the SBOM lists what actually ships rather than every
   folder on disk (which includes devDependencies). Returns null when npm is
   unavailable, so the caller can fall back to the on-disk walk. */
function prodRefs(appDir) {
  let out;
  try {
    // execSync with a literal command (no interpolated input) -- a plain
    // execFile("npm") can't be run directly on Windows (npm is a .cmd shim),
    // and the args here are fixed, so a shell command is safe and portable.
    out = execSync("npm ls --omit=dev --all --json", {
      cwd: appDir, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // `npm ls` exits non-zero on peer-dep warnings etc. but still prints the
    // JSON tree to stdout -- recover it from the error.
    out = e && e.stdout ? e.stdout.toString() : null;
  }
  if (!out) return null;
  let tree;
  try { tree = JSON.parse(out); } catch (_e) { return null; }
  const refs = new Set();
  (function walk(deps) {
    for (const [name, info] of Object.entries(deps || {})) {
      if (info && info.version) refs.add(`${name}@${info.version}`);
      if (info && info.dependencies) walk(info.dependencies);
    }
  })(tree.dependencies);
  return refs;
}

/* Components for one app: read license/description from each on-disk
   package.json (readPkg), but INCLUDE only the packages npm reports as
   production deps. Falls back to the full on-disk walk if npm is unavailable. */
function appComponents(appDir, group) {
  const all = walkNpm(path.join(appDir, "node_modules"));
  const refs = prodRefs(appDir);
  if (!refs) {
    process.stderr.write(`[sbom] WARN: \`npm ls\` failed for ${group}; SBOM may include dev deps\n`);
    return all.map((c) => ({ ...c, group }));
  }
  return all
    .filter((c) => refs.has(`${c.name}@${c.version}`))
    .map((c) => ({ ...c, group }));
}

function bom_ref(name, version) {
  return `pkg:${name}@${version || "unknown"}`;
}

function walkNpm(dir) {
  /* Walks a node_modules tree, one level deep into each scope, and
     returns [{ name, version, license, path }]. We treat any folder
     with a package.json as a component. */
  const components = [];
  if (!fs.existsSync(dir)) return components;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(dir, ent.name);
    if (ent.name.startsWith("@")) {
      /* Scoped: descend one level. */
      for (const ent2 of fs.readdirSync(sub, { withFileTypes: true })) {
        if (!ent2.isDirectory()) continue;
        const pkgPath = path.join(sub, ent2.name, "package.json");
        if (fs.existsSync(pkgPath)) {
          const p = readPkg(pkgPath);
          if (p) components.push(p);
        }
      }
    } else {
      const pkgPath = path.join(sub, "package.json");
      if (fs.existsSync(pkgPath)) {
        const p = readPkg(pkgPath);
        if (p) components.push(p);
      }
    }
  }
  return components;
}

function readPkg(pkgPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (!pkg.name || !pkg.version) return null;
    let license = pkg.license || null;
    if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
      license = pkg.licenses.map((l) => l.type || l).join(" OR ");
    }
    return {
      type: "library",
      name: pkg.name,
      version: pkg.version,
      "bom-ref": bom_ref(pkg.name, pkg.version),
      licenses: license ? [{ license: { id: String(license) } }] : undefined,
      purl: `pkg:npm/${pkg.name.replace("@", "%40")}@${pkg.version}`,
      description: pkg.description || undefined,
    };
  } catch (_e) {
    return null;
  }
}

function walkPythonSitePackages(dir) {
  /* Look for METADATA inside *.dist-info folders. */
  const components = [];
  if (!fs.existsSync(dir)) return components;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !ent.name.endsWith(".dist-info")) continue;
    const meta = path.join(dir, ent.name, "METADATA");
    if (!fs.existsSync(meta)) continue;
    try {
      const text = fs.readFileSync(meta, "utf-8");
      const name = (text.match(/^Name:\s*(.+)$/m) || [])[1];
      const version = (text.match(/^Version:\s*(.+)$/m) || [])[1];
      const license = (text.match(/^License:\s*(.+)$/m) || [])[1];
      if (!name || !version) continue;
      components.push({
        type: "library",
        name,
        version,
        "bom-ref": bom_ref(name, version),
        licenses: license ? [{ license: { id: license } }] : undefined,
        purl: `pkg:pypi/${name}@${version}`,
      });
    } catch (_e) { /* skip */ }
  }
  return components;
}

function dedupe(components) {
  const seen = new Set();
  const out = [];
  for (const c of components) {
    if (seen.has(c["bom-ref"])) continue;
    seen.add(c["bom-ref"]);
    out.push(c);
  }
  return out;
}

const pySite = path.join(repoRoot, "viewer", "python", "Lib", "site-packages");

const captureComponents = appComponents(path.join(repoRoot, "capture"), "capture");
const viewerComponents = appComponents(path.join(repoRoot, "viewer"), "viewer");
const pythonComponents = walkPythonSitePackages(pySite).map((c) =>
  ({ ...c, group: "viewer-python" }));

const allComponents = dedupe([
  ...captureComponents,
  ...viewerComponents,
  ...pythonComponents,
]);

const serialNumber = "urn:uuid:" + crypto.randomUUID();
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "internal", name: "generate-sbom.js", version: "1.0" }],
    component: {
      type: "application",
      "bom-ref": "pkg:internal/process-discovery-tracker",
      name: "Process Discovery Tracker",
      version: readRootVersion(),
      description:
        "Internal tool for capturing and analyzing process discovery sessions.",
    },
  },
  components: allComponents,
};

const distDir = path.join(repoRoot, "dist");
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, "SBOM.json");
fs.writeFileSync(outPath, JSON.stringify(bom, null, 2));

const counts = {
  capture: captureComponents.length,
  viewer: viewerComponents.length,
  python: pythonComponents.length,
  total: allComponents.length,
};
process.stdout.write(JSON.stringify(counts, null, 2) + "\n");
process.stdout.write(`SBOM written to ${outPath}\n`);
