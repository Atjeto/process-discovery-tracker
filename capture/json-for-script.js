"use strict";

/*
 * Safely serialize a value as JSON for embedding inside an inline <script>
 * of an HTML document we build in the main process and hand to loadURL.
 *
 * JSON.stringify alone is NOT safe in a script context: it does not escape
 * "</script>" or "<!--", so a string value such as
 *   "</script><img src=x onerror=alert(1)>"
 * closes the <script> element and injects markup. In these windows
 * nodeIntegration is true, so that is not merely XSS -- it is arbitrary code
 * execution. The labels/marker strings interpolated here come from the
 * operator config and prior marker firings, which a tampered or synced config
 * file can influence, and a stray "</script>" would also simply break the
 * window with no malice at all.
 *
 * We escape the HTML-significant characters (< > &) and the two JSON-legal
 * but JS-illegal line terminators (U+2028 / U+2029) into their \uXXXX form.
 * The result is still valid JSON and valid JS -- just inert as markup. Use
 * this for EVERY value interpolated into a <script>.
 *
 * The escape sequence is assembled from char codes (backslash = code 96 - 4 =
 * 92) and the target chars are matched via a RegExp built from a string, so
 * the source carries no literal backslash and no literal line-separator -- the
 * exact characters this routine exists to neutralize.
 */
var BACKSLASH = String.fromCharCode(92);
var LINE_SEP = String.fromCharCode(0x2028);
var PARA_SEP = String.fromCharCode(0x2029);
var DANGEROUS = new RegExp("[<>&" + LINE_SEP + PARA_SEP + "]", "g");

function jsonForScript(value) {
  return JSON.stringify(value === undefined ? null : value).replace(
    DANGEROUS,
    function (ch) {
      var hex = ("000" + ch.charCodeAt(0).toString(16)).slice(-4);
      return BACKSLASH + "u" + hex;
    }
  );
}

module.exports = { jsonForScript };
