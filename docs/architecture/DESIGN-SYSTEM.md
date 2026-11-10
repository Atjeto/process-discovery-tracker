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

**Warm Editorial** (default, light): warm off-white surfaces, a single
amber accent, slate-blue as the cool secondary, sharp corners, soft warm
shadows, geometric-sans typography.

**Studio Dark** (opt-in, dark): a cool charcoal-blue base, a teal
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
`@font-face`): the capture and analyst machines run offline and the
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
| `--fg-4` | `#c0b5a5` | decoration only: a separator, a caret, a large placeholder glyph (about 2:1; never the colour of a text, `viewer/fg4-guard.test.js`) |

**Accents and functional:**

| Token | Hex | Meaning |
|---|---|---|
| `--accent` | `#c07830` | amber: the primary accent's borders, marks and icons (3:1 is their rule; 3.5:1 on white), the playback bar's knob |
| `--accent-hover` | `#a86828` | darker amber: hover on accent fills |
| `--accent-muted` | `rgba(192,120,48,.10)` | faint amber wash: selection and range overlays |
| `--accent-text` | `#fff8f0` | text and icons on an accent fill |
| `--accent-fill` | `#99591c` | the fill of a control whose text is `--accent-text`: the primary button, the level shown (5.25:1; `--accent` gives 3.34:1) |
| `--accent-fill-hover` | `#874d15` | the same under the mouse (6.43:1) |
| `--link` | `#99591c` | text in the accent colour: link buttons, a success message, Help's section shown (5.53:1 on white) |
| `--field-border` | `#948771` | the edge of every text field, text area and select (3.52:1 on white) |
| `--accent-2` | `#5a7a8a` | slate blue: the secondary accent |
| `--accent-3` | `#b08040` | amber-gold: tertiary |
| `--warn` | `#b08040` | amber-gold: markers, warnings |
| `--bad` | `#a05a3a` | rust: errors, destructive, the save state's *Not saved* |
| `--rec` | `#c04040` | red: recording, danger buttons |
| `--va` | `#5a8f6a` | green: a ticked act of the Checklist, the Confirmed chip and status |

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
| 10 to 11px | **overline labels**: uppercase, `letter-spacing: 0.4px`, 600, `--fg-3` (section titles); the pane titles (`.editor-pane-title`, `h3`) and the step pane's section titles are 11px since 2.0.1, legible at 1024x720 | 600 |
| 11px | secondary text, mono data values (a transaction's head, `.run-meta`), hints | 400 |
| 12px | controls, buttons, body-secondary | 400 |
| 13px | **body** (the `html` base) and emphasized labels | 400 / 600 |
| 14px | icon buttons (mono glyphs), dialog titles | 400 to 600 |
| 15 to 16px | pane titles (the step panel's step name, `h2`) | 600 |

Larger sizes are glyphs only, never text: the empty state's icon, the
no-video icon, a list's remove cross.

### Capture windows share the same stack

The capture app's windows (the recording bar, the end summary, the welcome,
Help, consent, Settings, Profile) consume the **same two
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
  Overview's Checklist is the exception: an amber wash (`--accent-muted`)
  inside an `--accent` border.
- **Who fills a block**: one short line beside an Overview block's title
  (`.ov-block-who`, 11px `--fg-3`): "You write these. The PDD prints them."
  for the Document.
- **An empty field looks empty**: a document field's placeholder (its
  question) is light and italic (a mix of `--fg-3` and `--fg-4`, about 3:1
  on the field), well apart from written text.
- **The save state**: one quiet 11px word in the top bar (`--fg-3`), *Not
  saved* in `--bad` at 600 weight; it fades in again after each save (no
  fade with reduced motion). While the project zip is made, the Export
  button carries the status line's pulsing dot.
- **Buttons**: default, a white `--bg-2` fill, `--rule` border, `--fg`
  label, `--bg-3` with an accent border on hover. Primary: `--accent-fill`
  fill, `--accent-text` label, `--accent-fill-hover` on hover (one primary
  button per surface: the next act). Danger: `--rec` fill, and the plain
  look again while disabled. Link buttons (`.link-btn`) carry the small
  acts inside text (Attach, Replace, Remove; *Undo confirm* beside a
  transaction's Confirmed badge, in `--fg-3`; a section's add act beside
  its title, *Add note*, *Attach file...*; the Flow line's *Only when...*
  and *Go to...*). An act on the step or the steps themselves is a button,
  wherever it sits: *Dissolve sub-process* is a button in the step pane
  and in the breadcrumb (2.0.1). A quiet tool beside the main
  work (the Steps toolbar's *Apps outside the process...*; the Map's *Fit*, *Reset layout* and *Edited maps*, and
  the edited maps' row acts) is `.tool-btn`: 11px `--fg-2` in the text
  face on no fill inside the `--rule` border, the card's fill under the
  mouse (`.tool-btn.danger` outlined in `--bad`). Text never goes in an
  `.icon-btn`, a glyph's square in the mono face.
- **The top bar and the level buttons**: the top bar is white with a soft
  shadow; a level button is transparent until hovered (`--bg-3`); the
  active level is filled with `--accent-fill` (its label `--accent-text`),
  keeps its colours under the mouse, and carries `aria-current="page"`.
- **The Timeline's header column**: the lanes' names sit in a column of
  their own, like a video editor's track headers (`--bg-1`, a `--rule`
  divider from the lanes): a cell per lane as tall as the lane, a 14px key
  drawn in CSS that copies the lane's own marks, and the name in the mono
  label type (10px, uppercase, 1.2px spacing, `--fg-2`). The dividers
  between the cells run on across the lanes; a cell under the pointer takes
  a 2px accent edge and a 16% accent wash, and its lane an 11% one.
- **Bottom playback bar**: a video transport pinned below the levels as a
  flex sibling of `<main>` (`--bg-2`, top hairline); the `.hidden` class
  collapses it while no video is loaded.
- **Video pane**: stays dark (`#0a0908` under a radial glow) whatever the
  theme; video is dark by nature, and its overlay controls use light on
  dark. Without a video it collapses to a slim band.

## Contrast, focus, dialogs and messages

Lane A-1 (an accessibility pass, WCAG 2.1 AA, both themes):

- **Text on a fill uses `--accent-fill`.** A control whose label is
  `--accent-text` sits on `--accent-fill` (light `#99591c`, 5.25:1; dark
  the teal `--accent`, 9.1:1). `--accent` keeps the borders, marks and
  icons, where 3:1 is the rule. Text in the accent colour on a light surface
  is `--link`.
- **`--fg-4` is decoration only.** A muted text is `--fg-3` (5.13:1 on white,
  4.84:1 on `--bg`; dark 5.22:1 on `--bg-2`); on a fill (`--bg-3`,
  `--bg-4`, a selected row) it is `--fg-2` (light 5.86:1 on `--bg-3`, 5.29:1
  on `--bg-4`; dark 7.20:1 and 6.41:1), since `--fg-3` there is 4.32:1 and
  3.91:1. `viewer/fg4-guard.test.js` fails on a `color: var(--fg-4)` outside
  its short list of decorations.
- **A field has an edge**: `--field-border` (3.52:1 light, 3.14:1 dark
  against the card), never the `--rule` hairline. The capture windows' text
  fields use their own `--field-border` `#707080` (3.77:1 on the page).
- **One focus mark**: every control the keyboard reaches shows a 2 px solid
  `--accent-2` outline, offset 2 px, on `:focus-visible`; a text field, a
  text area and a select show it on `:focus`, offset 1 px, keeping their
  own border. Where a container clips it, the offset is inset (a
  transaction's row, the pane splitter, a row's rename field). No rule sets
  `outline: none` on a control.
- **A text action is easy to hit**: a `.link-btn` (and *Add* in a
  transcript row, *What is a step?*, a row's sub-steps button) has a hit
  area at least 24 px high, a pseudo-element centred on it that takes no
  room, so no row grows.
- **Dialogs keep the keyboard**: `modals.js` `holdFocus(dialog)` makes a
  `.modal` a dialog (`role="dialog"`, `aria-modal="true"`, labelled by its
  title), keeps Tab and Shift+Tab inside it and gives the focus back, when
  it closes, to the element that had it. The prompt, the confirm, the
  chooser, Help and the library builder use it; a dialog keeps its own keys
  and first focus (Help's: its section shown in the list).
- **Messages are heard and stay while read**: `#toast` is a polite live
  region (`role="status"`); an error is an alert (`role="alert"`), carries
  a *Dismiss* and stays until dismissed (or Escape while no dialog or menu
  is open), replaced by a newer message, or the next click or key press
  outside it once it has been up 3.5 s. An ordinary message goes after
  3.5 s, 8 s with an action or a hold (`dom.js` `toastLifetime`). A message
  never blocks the page: only its own buttons take clicks.
- **Names**: a glyph button carries an `aria-label` saying what it does
  (*Help*, *Close*, *Zoom in*; the theme toggle *Switch to the dark theme*
  and its inverse, kept by `theme.js`), its `title` kept; a menu's button
  carries `aria-haspopup` and `aria-expanded` kept with its menu; every page
  says `lang="en"`.

## UI copy style guide (lab Phase F)

Business users read every string the product renders: labels, tooltips,
empty states, the PDD, the Technical details. The register rules, set after the owner's
v1.1.0 walk-through ([docs/To-Do/ui-copy-feedback.md](../To-Do/ui-copy-feedback.md)):

1. **The test for every string:** would a business analyst with zero
   process-mining background understand it on first read? If a technical
   artifact name is unavoidable (BPMN, case anchor in analyst surfaces),
   the tooltip explains it in plain words.
2. **Sentences over fragments.** Say what the user gets or risks, not how
   the machine works ("Pressing this finishes a piece of work: we use it
   to know where one step ends", not "completion: step-boundary hint").
3. **No internal vocabulary in rendered copy.** The banned list below is
   enforced by `viewer/ui-copy-guard.test.js` (which exports it as
   `BANNED_COPY`; keep the two in sync). The terms stay legal in code
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
| provisional | "estimate: review before relying on it" |
| unsegmented, case-segmented | "no cases identified yet" / "cases identified" |
| posture | "data sharing mode" |
| modal pattern | "usual pattern" |
| cargo-cult | (code comments/docs only) |
| anchor *(worker/business copy)* | "the field that identifies the ticket/order"; it may stay in analyst surfaces with a plain tooltip |

**Worked examples (the bar), from the light version:**

- An act said by what the analyst gets: *Apps outside the process...*,
  *"Pick the apps that are not part of the process, for example Teams or
  Outlook used during the call, or the recorder itself. Their clicks and
  typing are left out of the steps and the map, and the project is
  analyzed again."*
- A mark explained where it shows: a stretch left out of the analysis on
  the Timeline, *"Left out of the analysis, 1:10 to 1:45: its steps are not
  drafted and its time is not counted. Click to include it again."*
- A state said in plain words: the Checklist's *Export the PDD*, *"The app
  keeps no record of an export, so this item is never ticked."*

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

## The step map's system labels (contract C18)

`process_map_step.bpmn` names the system a task is done in with words, not
colours (2.0.1): a short text annotation above the task
(`TextAnnotation_system_<k>`), or, when every task of a map done in a
system is done in the same one, one annotation for the whole map ("System:
SAP", `TextAnnotation_system`, placed inside the map where there is room,
else beside or under it). A step done outside every system is a manual
task: its hand marker says so, and it gets no label. A process manager
changes a label by typing in the map editor or any BPMN tool; no editor
could change the colours the map carried before (`bioc:fill`,
`bioc:stroke` and a legend naming them), so an edited map kept the wrong
ones. The labels are part of the picture: the Map's click does nothing on
one (`asis-links.js` `isSystemLabel`), and the PDD's pictures keep them.
Like the rest of the map, they are drawn in bpmn-js's default look on the
white page, the same in every place that draws the map.

## Notes

- The process map (the directly-follows graph on the Map level,
  `dfg-viewer.js`) reads its colours from `theme.js` `dfgStyleTokens()`:
  cytoscape renders to a `<canvas>` and cannot read CSS variables, so the
  active theme's hex snapshot is read fresh on each `render()`. Keep
  `dfgStyleTokens()` aligned with the `:root` token blocks if the palette
  ever changes. Its Start and End are small circles (`--bg-2` fill, an
  `--accent` ring for Start, a thick `--fg-2` ring for End); a condition on
  a line is boxed text at the boxes' 11px (`--bg` behind it, a `--rule`
  border) so it reads over the lines; a path set in Steps that no
  transaction took is dashed; a box whose step is flagged as waste has a
  dashed border and a last line, *Waste* (lane FX2).
- The **BPMN** maps (the vendored `bpmn-js`: the As-Is map shown on the Map
  level, the map editor, the pictures in the PDD and Export's map image)
  are **not** themed: they are documents, drawn on a white page in both
  themes, and the editor's canvas stays light in the dark theme too. Lines,
  events, text and the system labels are the library's black; since 2.0.1
  no task of the step map carries a colour ("The step map's system labels"
  above; an As-Is copy made before keeps the colours it had).
- Studio Dark replaces the earlier abandoned "stratified-dark" theme. That
  theme's low-contrast translucent-tint problem (issues D1 to D3 in the
  ARCHITECTURE-ISSUES register) is addressed here: `--fg-3` is held lighter
  than the source spec so muted labels keep at least 4.5:1 contrast on
  `--bg-2`.
