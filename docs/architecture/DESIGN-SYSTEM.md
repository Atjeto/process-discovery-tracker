# Design System

> Covers the viewer's styling: design tokens, colour palettes, and the
> conventions that govern how UI elements are coloured — including an honest
> account of the **colour-contrast problem** behind the recurring "everything
> blends together" complaints. Refactor framing is in
> [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).

## Where styling lives

| Source | Holds |
|---|---|
| [`viewer/styles.css`](../../viewer/styles.css) (~1,758 lines) | Every rule — one global stylesheet, no preprocessor, no modules |
| [`viewer/step-editor.js`](../../viewer/step-editor.js) `STEP_PALETTE` | Per-step block colours |
| [`viewer/phase-editor.js`](../../viewer/phase-editor.js) `PHASE_PALETTE` | Per-phase band colours |
| [`viewer/renderer.js`](../../viewer/renderer.js) `APP_PALETTE` / `appColor()` | Per-app activity-band colours |

Colour is therefore split: a CSS token layer for chrome, plus three hard-coded JS
arrays for data marks. There is no single colour source of truth.

## Design tokens

All tokens are CSS custom properties in the `:root` block at the top of
`styles.css`. The "stratified-dark" palette: each surface layer sits ~6 lightness
points above the one below.

**Backgrounds** — the surface stairway (stage → elevated):

| Token | Hex | Typical use |
|---|---|---|
| `--bg` | `#08080A` | app stage / base |
| `--bg-1` | `#16161C` | low panels |
| `--bg-2` | `#22222A` | cards, mini-timeline pane |
| `--bg-3` | `#2E2E37` | timeline track, inputs |
| `--bg-4` | `#3A3A44` | raised elements |
| `--bg-5` | `#484854` | top elevation |

**Foreground** — warm neutral grey scale:

| Token | Hex | Use |
|---|---|---|
| `--fg` | `#D8D6CE` | primary text |
| `--fg-2` | `#A8A69E` | secondary text |
| `--fg-3` | `#807E78` | tertiary / muted labels |
| `--fg-4` | `#5A5854` | faintest text, disabled |

**Accents & functional:**

| Token | Hex | Meaning |
|---|---|---|
| `--accent` | `#6E8A66` | sage green — primary accent |
| `--accent-2` | `#5A7488` | slate blue — secondary accent |
| `--accent-3` | `#A08050` | amber — tertiary accent |
| `--warn` | `#A08050` | amber — markers / warnings |
| `--bad` | `#885A42` | rust — errors / destructive |
| `--rec` | `#903838` | red — recording / danger buttons |

**Rules & geometry:** `--rule` `#424250` (panel borders, sits *above* panel bg so
it registers), `--rule-soft` `#2E2E37`; `--shadow` `0 2px 12px rgba(0,0,0,.35)`;
`--radius` `8px`, `--radius-sm` `5px`. **Fonts:** `--font-ui` IBM Plex Sans,
`--font-mono` IBM Plex Mono.

> The `:root` comment records a prior fix: the six `--bg-*` tokens were once
> squashed within ~12 hex points and "blurred into the same near-black smear".
> That pass widened the *background* stairway — but, by its own admission, left
> the **accents unchanged**. That is the unfinished half of the contrast problem.

## JS colour palettes (data marks)

| Constant | File:line | Values |
|---|---|---|
| `STEP_PALETTE` | `step-editor.js:167` | `#5A7488 #6E6A88 #886A78 #887A5A #5A8870 #787058 #5E6878` |
| `PHASE_PALETTE` | `phase-editor.js:149` | `#5A7488 #6E6A88 #886A78 #887A5A #5A8870 #787058` |
| `APP_PALETTE` / `appColor()` | `renderer.js:2455` / `:2464` | per-app cycling palette |

Two things to note: `STEP_PALETTE` and `PHASE_PALETTE` are **the same six colours**
(steps add one more) — so a step and a phase can be coloured identically. And every
colour is low-saturation by design ("already sit well on dark"); they cluster in a
narrow muted-mid band.

## The translucent-tint convention

Data marks are not painted with their palette colour directly — they are painted
with a **hex-alpha suffix** appended to the colour string, producing a faint tint:

| Mark | Background | Border | Text |
|---|---|---|---|
| Step block (`step-editor.js`) | `color + "1F"` (~12%) | `color + "55"` (~33%) | `color` (100%) |
| Phase band (`phase-editor.js`) | `color + "14"` (~8%) | `color + "44"` (~27%) | `color` (100%) |
| Activity band (`renderer.js`) | `appColor + "AA"` (~67%), inline | — | — |

On top of the alpha-tinted *background*, several marks also carry a CSS
**`opacity`** — a second, compounding transparency:

| Selector | `styles.css` | `opacity` |
|---|---|---|
| `.tl-band.tl-activity` | ~1331 | `0.65` (even rows `0.55`) |
| `.tl-band.tl-idle` | ~1339 | `0.8` |
| `.tl-screenshot` | ~1350 | `0.55` |
| `.tl-marker` | ~1366 | `0.85` |

So an activity band is its per-app colour at **67% background alpha**, then the
whole element at **~60% opacity** — an effective ~0.4. A step block is its palette
colour at **12%** on a `--bg-3` (`#2E2E37`) track.

## The contrast problem

The user-reported symptom is "all the colours blend into each other". The cause is
a *stack* of independently reasonable choices that compound badly:

1. **The palette is low-saturation.** `STEP_PALETTE` / `PHASE_PALETTE` / accents are
   all muted, mid-lightness, and close together in hue. They have little room to
   differ once any transparency is applied.
2. **Marks are tinted to 8–12%.** `color + "1F"` / `+ "14"` composites a step/phase
   colour almost entirely toward the `#2E2E37` track behind it — the result is
   near-grey and barely distinct from the `--fg-3`/`--fg-4` text greys.
3. **Opacity stacks on top of alpha.** Activity bands and screenshot dots apply a
   CSS `opacity` *in addition to* an alpha-suffixed background, so the effective
   visibility is the product of two transparencies.
4. **Steps and phases share a palette**, so the two entity types cannot be told
   apart by colour at all.
5. The earlier palette pass widened the **background** stairway but left **accents
   and the tint convention untouched** — so the fix addressed chrome, not data marks.

Net effect: borders (`+ "55"`) and text (`color` at 100%) are the only parts of a
step/phase block carrying real colour; the fill is nearly inert. Adjacent marks,
and marks-vs-background, separate weakly.

This is documented here as current-state fact. It is logged as a refactor target —
with candidate directions (raise tint alpha, raise palette saturation, drop the
double-opacity, give steps and phases distinct palettes, or lean on solid borders)
— in [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).
