# Design System

> Covers the viewer's styling: design tokens, colour palettes, fonts, and
> the conventions that govern how UI elements are coloured. The viewer
> ships **two themes** from a Claude Design handoff (May 2026): the
> default light **Warm Editorial** and an opt-in dark **Studio Dark**,
> switched at runtime by a topbar toggle.

## Where styling lives

| Source | Holds |
|---|---|
| [`viewer/styles.css`](../../viewer/styles.css) | Every rule — one global stylesheet, no preprocessor, no modules. `:root` holds the light tokens, `:root[data-theme="dark"]` the dark overrides; `@font-face` blocks load the self-hosted fonts |
| [`viewer/theme.js`](../../viewer/theme.js) | Theme state, persistence (`localStorage` `pdt.theme`), the `onChange` bus, and the light/dark JS palettes (app / step / phase) + the DFG token snapshot |
| [`viewer/fonts/`](../../viewer/fonts/) | Self-hosted woff2 — `plus-jakarta-sans.woff2`, `jetbrains-mono.woff2` (variable fonts) |
| [`viewer/views/flow-view.js`](../../viewer/views/flow-view.js) `appColor()` | Per-app activity-band colours — palette from `theme.js` |
| [`viewer/step-editor.js`](../../viewer/step-editor.js) / [`phase-editor.js`](../../viewer/phase-editor.js) | Per-step / per-phase band colours — palettes from `theme.js` |

Colour is split: a CSS token layer for chrome (both themes), plus JS
palettes for data marks that cannot read CSS variables — all owned by
`theme.js`, so a theme switch has one source of truth.

## The themes

**Warm Editorial** (default, light) — warm off-white surfaces, a single
amber accent, slate-blue as the cool secondary, sharp corners, soft warm
shadows, geometric-sans typography.

**Studio Dark** (opt-in, dark) — a cool charcoal-blue base, a teal
accent, a brighter foreground; cinematic and technical. It is a pure
recolour: geometry, typography, and layout are shared with Warm
Editorial.

The two themes share one set of CSS custom properties and one set of JS
palette accessors. `theme.js` flips between them: it sets
`data-theme="dark"` on `<html>` (light is the attribute's absence),
persists the choice to `localStorage` under `pdt.theme`, and notifies
subscribers so JS-painted views can repaint. A topbar button toggles it;
an inline bootstrap script in `index.html`'s `<head>` applies the stored
theme before first paint so there is no flash. The video stage carries a
subtle radial-gradient glow and a faint grid in both themes.

Fonts are **self-hosted** (woff2 under `viewer/fonts/`, loaded via
`@font-face`) — the capture and analyst machines run offline and the
renderer's Content-Security-Policy forbids a web-font CDN, so a
`fonts.googleapis.com` link is not an option. `font-src 'self'` already
covers the local files; no CSP change was needed.

## Design tokens

All tokens are CSS custom properties. The `:root` block at the top of
`styles.css` holds the light (Warm Editorial) values; the
`:root[data-theme="dark"]` block right below it overrides the same
property names with the dark (Studio Dark) values. Every other rule
consumes `var(--token)`, so the dark block is the only place dark chrome
is defined. The hex tables below are the **light** values.

**Backgrounds** — warm surface stairway (stage → white cards → elevated):

| Token | Hex | Typical use |
|---|---|---|
| `--bg` | `#faf8f4` | app stage / base |
| `--bg-1` | `#f4f1eb` | low panels |
| `--bg-2` | `#ffffff` | cards, panels, the topbar |
| `--bg-3` | `#f0ebe2` | timeline track, inputs, tab strip |
| `--bg-4` | `#e6e0d5` | raised fills, scrollbar thumb |
| `--bg-5` | `#dbd4c8` | top elevation |

**Foreground** — warm neutral scale, near-black down to muted taupe:

| Token | Hex | Use |
|---|---|---|
| `--fg` | `#2c2418` | primary text |
| `--fg-2` | `#635848` | secondary text |
| `--fg-3` | `#9a8e7e` | tertiary / muted labels |
| `--fg-4` | `#c0b5a5` | faintest text, disabled |

**Accents & functional:**

| Token | Hex | Meaning |
|---|---|---|
| `--accent` | `#c07830` | amber — primary accent |
| `--accent-hover` | `#a86828` | amber, darker — hover on accent fills |
| `--accent-muted` | `rgba(192,120,48,.10)` | faint amber wash — selection / range overlays |
| `--accent-text` | `#fff8f0` | text/icons on an accent fill |
| `--accent-2` | `#5a7a8a` | slate blue — secondary accent |
| `--accent-3` | `#b08040` | amber-gold — tertiary |
| `--warn` | `#b08040` | amber-gold — markers / warnings |
| `--bad` | `#a05a3a` | rust — errors / destructive |
| `--rec` | `#c04040` | red — recording / danger buttons |

**Rules, shadow, geometry:** `--rule` `#e5ddd0` and `--rule-soft`
`#ede7dc` are warm hairlines; `--shadow` `0 1px 3px rgba(40,30,10,.05),
0 0 0 1px rgba(40,30,10,.03)` and `--shadow-lg` `0 4px 16px
rgba(40,30,10,.08)`. Corners are **sharp**: `--radius` `4px`,
`--radius-sm` `3px`, `--radius-x` `2px`. `--transition` is `0.15s ease`.

**Fonts:** `--font-ui` Plus Jakarta Sans, `--font-mono` JetBrains Mono —
both self-hosted variable woff2, declared via `@font-face` at the top of
`styles.css`.

## Component conventions

- **Cards / panels** — `--bg-2` (white) fill, `var(--shadow)`, sharp
  `var(--radius)` corners. The timeline pane, annotations pane, aggregate
  panels, and the editor panes all follow this.
- **Buttons** — default: white `--bg-2` fill, `--rule` border, `--fg`
  label. Primary: `--accent` fill, `--accent-text` label,
  `--accent-hover` on hover. Danger: `--rec` fill.
- **Topbar / tab strip** — the topbar is white with a soft shadow; the
  tab strip is a `--bg-3` trough with the active tab lifted to white +
  shadow.
- **Bottom playback bar** — a global video transport pinned below the
  Session view as a flex sibling of `<main>` (`--bg-2`, top hairline);
  the `.hidden` class collapses it off the Session tab / when no
  recording is loaded.
- **Video pane** — stays dark (`#0a0908`) regardless of theme; video is
  dark by nature, and its overlay controls use light-on-dark colours.

## JS colour palettes (data marks)

Activity bands, step / phase blocks, and the DFG render colours into
inline styles or a `<canvas>` — none can read CSS variables. Those
palettes therefore live in `theme.js`, each with a light and a dark
variant, reached through accessors that return the active theme's set:

| Accessor | Consumer | Holds |
|---|---|---|
| `appColors()` | `flow-view.js` `appColor()` | per-app cycling palette + fixed assignments for known executables |
| `stepPalette()` | `step-editor.js` | per-step block colours |
| `phasePalette()` | `phase-editor.js` | per-phase band colours |
| `bandAlphas()` | `step-editor.js` / `phase-editor.js` | step / phase tint + border alpha (raised on dark so the tint clears the dark track) |
| `dfgStyleTokens()` | `dfg-viewer.js` | DFG hex snapshot mirroring the `:root` tokens |

Flow-timeline **activity bands** are painted with the solid per-app
colour and carry white labels — each palette colour is deep enough that
white text clears a comfortable contrast margin. **Step / phase**
mini-timeline blocks are painted with a translucent tint of the palette
colour (`timeline/timeline-core.js` `tintAlpha` / `borderAlpha`) plus a
stronger border and full-strength text. The dark variants are brighter
and use a higher tint alpha so the mark still reads on the dark `--bg-3`
track.

## Notes

- The DFG (Flow diagram) graph in `dfg-viewer.js` reads its colours from
  `theme.js` `dfgStyleTokens()` — cytoscape renders to a `<canvas>` and
  cannot read CSS variables, so the active theme's hex snapshot is read
  fresh on each `render()`. Keep `dfgStyleTokens()` aligned with the
  `:root` token blocks if the palette ever changes.
- `dfg-viewer.js` `exportSvg()` stays hardcoded to the **light** palette
  regardless of the active theme — an exported diagram goes into a
  document, which expects a light background.
- The **BPMN** diagram (vendored `bpmn-js`) is styled by the library's
  own CSS and is **not** themed; it stays light in both themes. The DFG
  is the fully themeable process-map tab.
- Studio Dark replaces the earlier abandoned "stratified-dark" theme.
  That theme's low-contrast translucent-tint problem (issues D1–D3 in
  the ARCHITECTURE-ISSUES register) is addressed here: the dark step /
  phase palettes are brighter and use a higher tint alpha, and `--fg-3`
  is held lighter than the source spec so muted labels keep ≥4.5:1
  contrast on `--bg-2`.
