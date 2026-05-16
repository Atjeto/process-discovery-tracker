# Design System

> Covers the viewer's styling: design tokens, colour palettes, fonts, and
> the conventions that govern how UI elements are coloured. The viewer
> uses the **Warm Editorial** theme — a light, warm, amber-accented
> design applied from a Claude Design handoff (May 2026), which replaced
> the earlier "stratified-dark" theme outright.

## Where styling lives

| Source | Holds |
|---|---|
| [`viewer/styles.css`](../../viewer/styles.css) | Every rule — one global stylesheet, no preprocessor, no modules. `:root` holds the tokens; `@font-face` blocks load the self-hosted fonts |
| [`viewer/fonts/`](../../viewer/fonts/) | Self-hosted woff2 — `plus-jakarta-sans.woff2`, `jetbrains-mono.woff2` (variable fonts) |
| [`viewer/views/flow-view.js`](../../viewer/views/flow-view.js) `APP_PALETTE` / `appColor()` | Per-app activity-band colours |
| [`viewer/step-editor.js`](../../viewer/step-editor.js) `STEP_PALETTE` | Per-step block colours |
| [`viewer/phase-editor.js`](../../viewer/phase-editor.js) `PHASE_PALETTE` | Per-phase band colours |

Colour is split: a CSS token layer for chrome, plus three hard-coded JS
arrays for data marks.

## The theme

**Warm Editorial** is a light theme: warm off-white surfaces, a single
amber accent, slate-blue as the cool secondary, sharp corners, soft warm
shadows, and geometric-sans typography.

Fonts are **self-hosted** (woff2 under `viewer/fonts/`, loaded via
`@font-face`) — the capture and analyst machines run offline and the
renderer's Content-Security-Policy forbids a web-font CDN, so a
`fonts.googleapis.com` link is not an option. `font-src 'self'` already
covers the local files; no CSP change was needed.

## Design tokens

All tokens are CSS custom properties in the `:root` block at the top of
`styles.css`.

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

| Constant | File | Values |
|---|---|---|
| `APP_PALETTE` / `appColor()` | `flow-view.js` | per-app cycling palette plus fixed assignments for known executables |
| `STEP_PALETTE` | `step-editor.js` | per-step block colours |
| `PHASE_PALETTE` | `phase-editor.js` | per-phase band colours |

Flow-timeline **activity bands** are painted with the solid per-app
colour and carry white labels — the app palette is dark enough that
white text clears a comfortable contrast margin. **Step / phase**
mini-timeline blocks are painted with a translucent tint of the palette
colour (`timeline/timeline-core.js` `tintAlpha` / `borderAlpha`) plus a
stronger border and full-strength text, so the mark reads against the
light `--bg-3` track.

## Notes

- The DFG (Flow diagram) graph in `dfg-viewer.js` keeps a **token
  snapshot** in JS — cytoscape and the SVG export cannot read CSS
  variables. Those hex values are commented with the token they mirror;
  keep them aligned with `:root` if the palette ever changes.
- The earlier dark "stratified-dark" theme — and the low-contrast
  translucent-tint problem it carried (issues D1–D3 in the
  ARCHITECTURE-ISSUES register) — are obsolete: the theme was replaced
  rather than patched.
