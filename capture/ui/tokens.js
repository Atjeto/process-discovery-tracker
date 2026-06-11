"use strict";
/* Shared typography tokens for every capture window.
 *
 * The values are duplicated VERBATIM from the viewer's design system
 * (docs/architecture/DESIGN-SYSTEM.md, viewer/styles.css) -- capture and
 * viewer are separate apps, so there is no cross-import; keep the two in
 * sync by hand when the design system changes. The woff2 files under
 * ui/fonts/ are byte-copies of viewer/fonts/.
 *
 * Fonts are inlined as data: URIs because most capture windows load via
 * data: URLs, where the CSP's `default-src 'self'` blocks file: fetches
 * but `font-src data:` is already allowed in every window.
 */
const fs = require("node:fs");
const path = require("node:path");

let cachedCss = null;

function fontFaceCss() {
  if (cachedCss) return cachedCss;
  const b64 = (file) =>
    fs.readFileSync(path.join(__dirname, "fonts", file)).toString("base64");
  cachedCss =
    "\n" +
    '@font-face { font-family: "Plus Jakarta Sans";' +
    " src: url(data:font/woff2;base64," + b64("plus-jakarta-sans.woff2") + ') format("woff2");' +
    " font-weight: 200 800; font-style: normal; font-display: swap; }\n" +
    '@font-face { font-family: "JetBrains Mono";' +
    " src: url(data:font/woff2;base64," + b64("jetbrains-mono.woff2") + ') format("woff2");' +
    " font-weight: 100 800; font-style: normal; font-display: swap; }\n" +
    ":root {\n" +
    '  --font-ui: "Plus Jakarta Sans", -apple-system, "Segoe UI", system-ui, "Helvetica Neue", sans-serif;\n' +
    '  --font-mono: "JetBrains Mono", "Consolas", "Cascadia Code", "Courier New", monospace;\n' +
    "}\n";
  return cachedCss;
}

/* Prepend the shared token styles inside a window's first <style> block,
   so every later rule (and the window's own :root vars) can consume
   var(--font-ui) / var(--font-mono). */
function injectTokens(html) {
  return String(html).replace("<style>", "<style>" + fontFaceCss());
}

module.exports = { fontFaceCss, injectTokens };
