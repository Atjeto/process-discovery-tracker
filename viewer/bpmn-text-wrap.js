"use strict";

/*
 * bpmn-text-wrap.js: the maps' names break between words (lane FX3,
 * validation pass 3, F26). diagram-js wraps a name by guessing how many
 * characters fit a line; when a line it wraps starts with a hyphen or a
 * space (the second line of a drafted name such as "Excel - Order
 * Tracking.xlsx: Save workbook"), the guess finds no place to break and it
 * cuts a word in two ("Tracking.x" and "lsx: Save workbook"). This bpmn-js
 * module lays each name out first, word by word, in the name's own font and
 * box, so every line diagram-js is given already fits and it has nothing
 * to cut: a word is broken only when it is wider than the box on its own.
 *
 * Used by every bpmn-js the viewer creates: the Map's picture (asis-view.js),
 * the map editor (bpmn-viewer.js), and the pictures of the PDD and Export's
 * map image (refmap-ui.js). The diagram's file is never changed: only the
 * text drawn.
 */

/* The lines of `text` (its own line breaks kept), each wrapped between
   words so that `measure(line)` stays within `maxWidth`; a word wider than
   that keeps its own line (diagram-js then cuts it, the one case left).
   Pure: `measure(text)` gives a width. */
function wrapLines(text, maxWidth, measure) {
  const out = [];
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const words = line.split(" ").filter((w) => w !== "");
    if (!words.length) { out.push(""); continue; }
    let cur = "";
    for (const word of words) {
      const next = cur ? cur + " " + word : word;
      if (!cur || measure(next) <= maxWidth) cur = next;
      else { out.push(cur); cur = word; }
    }
    out.push(cur);
  }
  return out;
}

/* The width diagram-js lays a name out in: its box less the padding (a
   number, or { left, right }), as diagram-js's Text.layoutText reads them. */
function innerWidth(options) {
  const o = options || {};
  const box = o.box || {};
  const width = Number.isFinite(box.width) ? box.width : 150;   // diagram-js's DEFAULT_LABEL_SIZE
  const pad = o.padding;
  const left = typeof pad === "number" ? pad : (pad && Number.isFinite(pad.left) ? pad.left : 0);
  const right = typeof pad === "number" ? pad : (pad && Number.isFinite(pad.right) ? pad.right : 0);
  return width - left - right;
}

/* A text's width in a font, measured on a canvas as the browser draws it
   (diagram-js measures an SVG text the same way). */
let _ctx = null;
function _measurer(style) {
  const s = style || {};
  const size = parseFloat(s.fontSize) || 12;
  const font = (s.fontWeight || "normal") + " " + size + "px " + (s.fontFamily || "Arial, sans-serif");
  return (text) => {
    try {
      if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
      _ctx.font = font;
      return _ctx.measureText(String(text)).width;
    } catch (_) {
      return String(text).length * size * 0.6;
    }
  };
}

/* Room left in a line for the rounding of the two measures: a line laid
   out here is never judged a pixel too wide by diagram-js. */
const SLACK = 3;

/* The bpmn-js module: its textRenderer draws each name wrapped here first. */
function PdtTextWrap(textRenderer) {
  if (!textRenderer || typeof textRenderer.createText !== "function") return;
  const create = textRenderer.createText.bind(textRenderer);
  textRenderer.createText = function (text, options) {
    try {
      const style = Object.assign({}, textRenderer.getDefaultStyle ? textRenderer.getDefaultStyle() : {},
        (options && options.style) || {});
      const max = innerWidth(options) - SLACK;
      if (typeof text === "string" && text && max > 0) text = wrapLines(text, max, _measurer(style)).join("\n");
    } catch (e) {
      console.error("[bpmn-text-wrap] a name was drawn as diagram-js wraps it:", e);
    }
    return create(text, options);
  };
}
PdtTextWrap.$inject = ["textRenderer"];

const TextWrapModule = { __init__: ["pdtTextWrap"], pdtTextWrap: ["type", PdtTextWrap] };

module.exports = { TextWrapModule, wrapLines, innerWidth };
