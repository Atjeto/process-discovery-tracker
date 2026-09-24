# Design System

> Covers the viewer's styling: design tokens, colour palettes, fonts, and
> the conventions that govern how UI elements are coloured. The viewer
> ships **two themes** from a Claude Design handoff (May 2026): the
> default light **Warm Editorial** and an opt-in dark **Studio Dark**,
> switched at runtime by a topbar toggle.

## Where styling lives

| Source | Holds |
|---|---|
| [`viewer/styles.css`](../../viewer/styles.css) | Every rule: one global stylesheet, no preprocessor, no modules. `:root` holds the light tokens, `:root[data-theme="dark"]` the dark overrides; `@font-face` blocks load the self-hosted fonts |
| [`viewer/theme.js`](../../viewer/theme.js) | Theme state, persistence (`localStorage` `pdt.theme`), the `onChange` bus, and the two JS palettes: the per-app band colours and the process map's colour snapshot |
| [`viewer/fonts/`](../../viewer/fonts/) | Self-hosted woff2: `plus-jakarta-sans.woff2`, `jetbrains-mono.woff2` (variable fonts) |
| [`viewer/views/flow-view-apps.js`](../../viewer/views/flow-view-apps.js) `appColor()` | The timeline's per-app band colours, from `theme.js` |
| [`viewer/dfg-viewer.js`](../../viewer/dfg-viewer.js) | The process map's colours, from `theme.js` |

Colour is split: a CSS token layer for chrome (both themes), plus JS
palettes for data marks that cannot read CSS variables, all owned by
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

**Backgrounds**, a warm surface stairway (stage, white cards, elevated):

| Token | Hex | Typical use |
|---|---|---|
| `--bg` | `#faf8f4` | app stage / base |
| `--bg-1` | `#f4f1eb` | low panels |
| `--bg-2` | `#ffffff` | cards, panels, the top bar |
| `--bg-3` | `#f0ebe2` | timeline track, inputs, hovers |
| `--bg-4` | `#e6e0d5` | raised fills, scrollbar thumb |
| `--bg-5` | `#dbd4c8` | top elevation |

**Foreground**, a warm neutral scale from near-black to muted taupe:

| Token | Hex | Use |
|---|---|---|
| `--fg` | `#2c2418` | primary text |
| `--fg-2` | `#635848` | secondary text |
| `--fg-3` | `#786c5a` | tertiary / muted labels (at least 4.5:1 on `--bg`/`--bg-1`; darkened from `#9a8e7e`, which was 3.03:1) |
| `--fg-4` | `#c0b5a5` | faintest text, disabled: decorative only (below AA; never load-bearing text) |

**Accents and functional:**

| Token | Hex | Meaning |
|---|---|---|
| `--accent` | `#c07830` | amber: the primary accent (the active level, primary buttons, the next act) |
| `--accent-hover` | `#a86828` | darker amber: hover on accent fills |
| `--accent-muted` | `rgba(192,120,48,.10)` | faint amber wash: selection and range overlays |
| `--accent-text` | `#fff8f0` | text and icons on an accent fill |
| `--accent-2` | `#5a7a8a` | slate blue: the secondary accent |
| `--accent-3` | `#b08040` | amber-gold: tertiary |
| `--warn` | `#b08040` | amber-gold: markers, warnings |
| `--bad` | `#a05a3a` | rust: errors, destructive |
| `--rec` | `#c04040` | red: recording, danger buttons |
| `--va` | `#5a8f6a` | green: a done stage of What is left, the Confirmed chip and status |

`--bnva` and `--nva` are still defined next to `--va` (the product
edition's waste bars) and nothing reads them.

**Rules, shadow, geometry:** `--rule` `#e5ddd0` and `--rule-soft`
`#ede7dc` are warm hairlines; `--shadow` `0 1px 3px rgba(40,30,10,.05),
0 0 0 1px rgba(40,30,10,.03)` and `--shadow-lg` `0 4px 16px
rgba(40,30,10,.08)`. Corners are **sharp**: `--radius` `4px`,
`--radius-sm` `3px`, `--radius-x` `2px`. `--transition` is `0.15s ease`.

**Fonts:** `--font-ui` Plus Jakarta Sans, `--font-mono` JetBrains Mono,
both self-hosted variable woff2, declared via `@font-face` at the top of
`styles.css`.

### Type scale (both apps)

Every font-size sits on this ladder; don't invent in-between steps on new
surfaces:

| Step | Use | Weight |
|---|---|---|
| 8 to 9px | micro mono badges (state glyphs, axis ticks, the screenshot rail label) | 400 to 600 |
| 10px | **overline labels**: uppercase, `letter-spacing: 0.4px`, 600, `--fg-3` (section titles) | 600 |
| 11px | secondary text, mono data values, hints | 400 |
| 12px | controls, buttons, body-secondary | 400 |
| 13px | **body** (the `html` base) and emphasized labels | 400 / 600 |
| 14px | icon buttons (mono glyphs), dialog titles | 400 to 600 |
| 15 to 16px | pane titles (the step panel's step name, `h2`) | 600 |

Larger sizes are glyphs only, never text: the empty state's icon, the
no-video icon, a list's remove cross.

### Capture windows share the same stack

The capture app's windows (the recording bar, the end summary, the welcome,
Help, consent, Settings, Profile, Recording setup) consume the **same two
font tokens** via [`capture/ui/tokens.js`](../../capture/ui/tokens.js),
which injects an `@font-face` + `:root { --font-ui; --font-mono }` block
into every window's markup, the fonts inlined as `data:` URIs (most capture
windows load from `data:` URLs, where `file:` fetches are CSP-blocked). The
token values are **duplicated verbatim** from `styles.css`: capture and
viewer are separate apps with no cross-imports, so when the stack changes
here, update `capture/ui/tokens.js` (and the `capture/ui/fonts/`
byte-copies) by hand in the same commit.

## Component conventions

- **Cards and panels**: `--bg-2` (white) fill, `var(--shadow)`, sharp
  `var(--radius)` corners. The timeline pane, the Timeline's side panel,
  the Steps panes, the Map panel and the Overview's sections follow this;
  the step panel is a white column with a hairline on its left. The
  Overview's What is left line is the exception: an amber wash
  (`--accent-muted`) inside an `--accent` border.
- **Buttons**: default, a white `--bg-2` fill, `--rule` border, `--fg`
  label, `--bg-3` with an accent border on hover. Primary: `--accent`
  fill, `--accent-text` label, `--accent-hover` on hover (one primary
  button per surface: the next act). Danger: `--rec` fill, and the plain
  look again while disabled. Link buttons (`.link-btn`) carry the small
  acts inside text (Attach, Replace, Remove).
- **The top bar and the level buttons**: the top bar is white with a soft
  shadow; a level button is transparent until hovered (`--bg-3`); the
  active level is filled with `--accent`, and keeps its colours under the
  mouse.
- **Bottom playback bar**: a video transport pinned below the levels as a
  flex sibling of `<main>` (`--bg-2`, top hairline); the `.hidden` class
  collapses it while no video is loaded.
- **Video pane**: stays dark (`#0a0908` under a radial glow) whatever the
  theme; video is dark by nature, and its overlay controls use light on
  dark. Without a video it collapses to a slim band.

## UI copy style guide (lab Phase F)

Business users read every string the product renders — labels, tooltips,
empty states, the memo, the PDD. The register rules, set after the owner's
v1.1.0 walk-through ([docs/To-Do/ui-copy-feedback.md](../To-Do/ui-copy-feedback.md)):

1. **The test for every string:** would a business analyst with zero
   process-mining background understand it on first read? If a technical
   artifact name is unavoidable (BPMN, case anchor in analyst surfaces),
   the tooltip explains it in plain words.
2. **Sentences over fragments.** Say what the user gets or risks, not how
   the machine works ("Pressing this finishes a piece of work — we use it
   to know where one step ends", not "completion: step-boundary hint").
3. **No internal vocabulary in rendered copy.** The banned list below is
   enforced by `viewer/ui-copy-guard.test.js` (which exports it as
   `BANNED_COPY` — keep the two in sync). The terms stay legal in code
   identifiers, JSON keys, comments, and docs.

| Banned in copy | Say instead |
|---|---|
| canon, fact authority, off-contract | "treat as exploration, not evidence" / "advanced" |
| Tier 1 / Tier 2 / Tier 3 | what it means: "measured" / "needs confirmed cases" |
| inductive-miner | "auto-generated process model" |
| taxonomy-classified | "by app category" |
| grain notch | "detail level" |
| value-free | "with ticket/order values stripped out" |
| motif | "repeated sequence" |
| segment-grain | "step sequence" |
| heuristic | "estimate" / "automatic guess" / "by default" |
| provisional | "estimate — review before relying on it" |
| unsegmented, case-segmented | "no cases identified yet" / "cases identified" |
| posture | "data sharing mode" |
| modal pattern | "usual pattern" |
| cargo-cult | (code comments/docs only) |
| anchor *(worker/business copy)* | "the field that identifies the ticket/order" — may stay in analyst Machine surfaces with a plain tooltip |

**Worked examples (the bar):**

- Expert drawer → **"Advanced views** — These views use methods that need
  cleaner data than desktop recording can provide, so treat them as
  exploration, not evidence. The files are still exported for specialists."
- App Library checklist: `completes step` → **"'Done' action"** (*"Pressing
  this finishes a piece of work — like Save, Submit or Send. We use it to
  know where one step ends and the next begins."*); `carries value` →
  **"Workers type data here"**; `case-id source` → **"Identifies the
  ticket/order"** (*"What's typed here tells us which ticket, order or
  customer the work belongs to — it lets the app split a long recording
  into separate cases."*).
- Free-text placeholder → *"What does this do, in plain words? e.g. 'sends
  the order to billing'"*.

## JS colour palettes (data marks)

The timeline's activity bands and the process map render colours into
inline styles or a `<canvas>`, where CSS variables cannot be read. Those
palettes therefore live in `theme.js`, each with a light and a dark
variant, reached through accessors that return the active theme's set:

| Accessor | Consumer | Holds |
|---|---|---|
| `appColors()` | `views/flow-view-apps.js` `appColor()` | per-app cycling palette + fixed colours for known executables |
| `dfgStyleTokens()` | `dfg-viewer.js` | the map's hex snapshot, mirroring the `:root` tokens |

Timeline **activity bands** are painted with the solid per-app colour and
carry white labels; each palette colour is deep enough that white text
clears a comfortable contrast margin. The dark variants are brighter and
cooler, so the bands read on the dark base. A band is coloured by its
application and named by its business system (a Chrome band on Salesforce
reads "Salesforce"), so two systems in one browser share a colour.

## Notes

- The process map (the directly-follows graph on the Map level,
  `dfg-viewer.js`) reads its colours from `theme.js` `dfgStyleTokens()`:
  cytoscape renders to a `<canvas>` and cannot read CSS variables, so the
  active theme's hex snapshot is read fresh on each `render()`. Keep
  `dfgStyleTokens()` aligned with the `:root` token blocks if the palette
  ever changes.
- `dfg-viewer.js` `exportSvg()` stays hardcoded to the **light** palette
  whatever the theme: an exported map goes into a document, which expects
  a light background.
- The **BPMN** maps (the vendored `bpmn-js`: the As-Is map shown on the Map
  level, the map editor, the pictures in the PDD) are drawn in the
  library's own document colours (black lines and text, white shapes) and
  are **not** themed: the editor's canvas stays light in the dark theme too.
- Studio Dark replaces the earlier abandoned "stratified-dark" theme. That
  theme's low-contrast translucent-tint problem (issues D1 to D3 in the
  ARCHITECTURE-ISSUES register) is addressed here: `--fg-3` is held lighter
  than the source spec so muted labels keep at least 4.5:1 contrast on
  `--bg-2`.
