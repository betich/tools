---
name: betich's tools
description: A workshop bench after dark — the betich.me voice taken into track.betich.me's instrument panel.
extends: track.betich.me
colors:
  ground: "#07071B"
  bloom: "#0C0C22"
  panel: "#101026"
  panel-high: "#16162A"
  ink: "#F3F2FF"
  prose: "rgba(244,243,255,0.82)"
  prose-muted: "rgba(244,243,255,0.72)"
  label: "rgba(244,243,255,0.70)"
  meta: "rgba(244,243,255,0.55)"
  hairline: "rgba(244,243,255,0.16)"
  wash: "rgba(244,243,255,0.12)"
  hairline-faint: "rgba(244,243,255,0.08)"
  hover-wash: "rgba(244,243,255,0.06)"
  periwinkle: "#B9B8EF"
  signal: "#4845DA"
  scrim: "rgb(3 3 12 / 0.92)"
typography:
  display:
    fontFamily: "Roboto Mono, Sarabun, monospace"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.02em"
    case: upper
  headline:
    fontFamily: "Roboto Mono, Sarabun, monospace"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.08em"
    case: upper
  title:
    fontFamily: "Roboto Mono, Sarabun, monospace"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.22em"
    case: upper
  body:
    fontFamily: "Inter, IBM Plex Thai, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7143
    case: sentence
  label:
    fontFamily: "Roboto Mono, Sarabun, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.1em"
    case: upper
  meta:
    fontFamily: "Roboto Mono, Sarabun, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.18em"
    case: upper
rounded:
  none: "0px"
  hairline: "2px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  card: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  section: "56px"
components:
  rail-tab:
    backgroundColor: "transparent"
    textColor: "{colors.meta}"
    typography: "{typography.meta}"
    padding: "16px 0"
  rail-tab-active:
    backgroundColor: "rgba(244,243,255,0.05)"
    textColor: "{colors.ink}"
  text-button:
    backgroundColor: "transparent"
    textColor: "{colors.meta}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
  text-button-hover:
    textColor: "{colors.periwinkle}"
  text-button-active:
    textColor: "{colors.ink}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.meta}"
    height: "16px"
    width: "16px"
  icon-button-hover:
    textColor: "{colors.periwinkle}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.label}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  chip-hover:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.ground}"
  panel:
    backgroundColor: "rgba(244,243,255,0.035)"
    textColor: "{colors.label}"
    rounded: "{rounded.card}"
    padding: "20px"
  panel-hover:
    backgroundColor: "rgba(244,243,255,0.06)"
    textColor: "{colors.periwinkle}"
  control:
    backgroundColor: "rgba(244,243,255,0.04)"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "8px 10px"
  control-focus:
    backgroundColor: "rgba(244,243,255,0.06)"
  dropzone:
    backgroundColor: "transparent"
    textColor: "{colors.label}"
    rounded: "{rounded.card}"
    padding: "40px 24px"
  dropzone-active:
    backgroundColor: "rgba(72,69,218,0.12)"
    textColor: "{colors.periwinkle}"
  menu:
    backgroundColor: "{colors.panel-high}"
    textColor: "{colors.prose}"
    rounded: "{rounded.card}"
    padding: "8px"
  menu-item-hover:
    backgroundColor: "{colors.hover-wash}"
    textColor: "{colors.periwinkle}"
  tooltip:
    backgroundColor: "{colors.panel-high}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.xs}"
    padding: "4px 9px"
  toast:
    backgroundColor: "{colors.panel-high}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 16px"
---

# Design System: betich's tools

## Overview

**Creative North Star: "The Instrument Panel"**

This site used to be a paper notebook. It is now the console you read the notebook by.

The voice did not change — Roboto Mono still carries every piece of structure, Inter still appears only inside running prose, and Thai is still covered by Sarabun so it never falls back mid-sentence. What changed is the room the lights are on in. The ground is `#07071B`, a near-black with indigo in it; ink is `#F3F2FF`, a lavender white held at four alpha steps rather than mixed into four separate greys. One bloom of light sits behind the top of the page and everything else is flat. Nothing casts a shadow, because nothing here is made of paper.

The reference is [track.betich.me](https://track.betich.me), which is the same person's work in the same typeface solving a different problem: a compass, a map, a status line, a tab bar. Its conventions are adopted wholesale — the uppercase wide-tracked labels, the single status dot, the fixed rail across the floor of the screen, the `MADE WITH <3 BY BETICH.ME` line under it. A visitor arriving here from there should not have to learn a second system.

**Key Characteristics:**

- Structure is uppercase mono with wide tracking: `0.18em` at 11px, `0.1em` at 12px, `0.22em` on a page title. Sentence case begins at the first paragraph of prose and nowhere earlier.
- Two accents with different jobs: periwinkle `#B9B8EF` is where an interactive element _arrives_, indigo `#4845DA` means _live_ — the status dot, the needle, the wash under a panel you are about to open.
- Depth is alpha, not elevation. A raised surface is the ground plus 3.5% ink; a hairline is the ground plus 12–16%.
- Navigation never scrolls away: a hairline bar at the top, a three-cell rail pinned to the floor.
- Every number is `tabular-nums` and zero-padded — `01 / 36`, `2242×3171 · 46%`.
- Both tools work with the server down, and the status dot says which mode you are in rather than leaving you to find out.

## What carried over, and what did not

Carried over from betich.me: Roboto Mono + Sarabun + Inter, the 14/12/11px scale, hairlines instead of shadows, `tabular-nums`, timestamps in `YYYY.MM.DD HH:MM`, and the rule that a single accent does all the pointing.

Deliberately dropped:

- **The paper ground and the left spine.** Replaced by the dark ground and track's top bar plus bottom rail.
- **Lowercase UI labels.** The reference is uppercase and tracked; that is now the structural register.
- **Italic-means-here.** Active state is full ink plus a 1px periwinkle underline, which survives on a dark ground where italic does not read.
- **Section numbers on the index.** Two tools in a fixed order carry no information in `01` / `02`, so the numbers went. Sequence numbers remain only where they are data: the layer stack, the queue, the row counter, the saved-project count.
- **Eyebrow lines above headings.** A tool panel's tagline sits _under_ its rule, at the bottom of the panel, beside the affordance — never above the name.

## Colors

One ground, one ink, two accents. There is no third hue anywhere in the product, and disabled is opacity, never colour.

### Ground

- **Ground** (`#07071B`): The universal page background, set on `html` as well as `body` so an overscroll never flashes white.
- **Bloom** (`#0C0C22`): The checkerboard's base, and the colour the bloom resolves toward.
- **Panel / Panel High** (`#101026` / `#16162A`): The two floating surfaces — the font picker popover, the share popover, the tooltip and the toast. Nothing in the document flow uses them; in-flow surfaces are an alpha of ink instead, so they inherit whatever is behind them.

### Ink

A single colour at four steps. Contrast was measured against the ground, not assumed:

| token | alpha | contrast | use                                                |
| ----- | ----- | -------- | -------------------------------------------------- |
| ink   | 1.0   | 17:1     | values, headings, the active tab, a selected layer |
| prose | 0.82  | 11:1     | running prose in a panel                           |
| label | 0.70  | 7.5:1    | field values, list rows, tool blurbs               |
| meta  | 0.55  | 5.0:1    | every uppercase micro-label, status, counters      |

**0.55 is the floor for text.** Below it the ramp is hairlines only — `0.16`, `0.12`, `0.08` — and none of them ever carries a glyph.

### Accents

- **Periwinkle** (`#B9B8EF`): The destination. Hover, focus, the active underline, the selection box on the canvas, the caret, the slider thumb's edge.
- **Signal** (`#4845DA`): Life. The API dot when the server answers (and only then — it also gets the slow pulse), the bezel needle, the wash that rises inside a tool panel on approach, and the text selection background.

### Named Rules

**The Two-Job Rule.** Periwinkle is where you _arrive_; indigo means something is _live_. An element that cannot be acted on never sits in periwinkle, and an element that is merely hovered never turns indigo.

**The Alpha-Depth Rule.** A surface in the document flow is the ground plus an alpha of ink. Solid panel colours belong only to things that float above the page. This is why the layout survives the bloom: everything in flow is transparent to it.

**The No-Status-Colour Rule.** No green success, no red error, no amber warning. A failed job states what went wrong in meta-grey; a compression that saved bytes is periwinkle because it is good news, not because it is a "success state". Direction is carried by the sign on the number.

## Typography

**Structure:** Roboto Mono (400/500/700, plus 400 italic), backed by Sarabun so Thai never falls back.
**Prose:** Inter, backed by IBM Plex Thai.

**Character:** The reference reads like a field instrument — everything labelled, everything measured, nothing decorated. Uppercase with open tracking is what makes a 11px mono label legible at a glance and is the single strongest signal that this is the same family of sites as track.

### Hierarchy

- **Display** (700, 24px, `0.02em`, upper): the name of a tool you can actually open, on the index grid. Reserved for live things.
- **Headline** (700, 18px, `0.08em`, upper): a secondary tool panel's name.
- **Title** (700, 15px, `0.22em`, upper): the page heading, and the wordmark at `0.32em`. Page titles are small and widely tracked; the site does not shout its own name.
- **Body** (400, 14px/1.71, Inter, sentence case): the only sentence-case text in the product. Measure is capped at `62ch` on the index and `46ch` inside a panel.
- **Label** (400, 12px, `0.1em`, upper): what a control holds. Values the user typed drop tracking to normal, because a filename or a hex code is not a label.
- **Meta** (400, 11px, `0.18em`, upper): every micro-label, status line, counter and hint. The workhorse.

### Named Rules

**The Tracking-Rises-As-Size-Falls Rule.** `0.22em` at 15px, `0.18em` at 11px, `0.1em` at 12px, and normal for user-entered values. Tracking is how this system adds formality; weight is reserved for hierarchy.

**The Sentence-Case Boundary.** Chrome is uppercase. Prose is sentence case. There is no third register, and a hint under a field is prose.

**The Typed-Value Rule.** Anything the user typed or the machine produced — a filename, a hex value, a layer's text, a font family — renders with normal tracking so it can be read as data rather than as a label.

## Layout

**Top bar.** Sticky, hairline bottom, `backdrop-blur-xl` over the ground at 70% so content dissolves under it rather than colliding. Wordmark left, API state right.

**Bottom rail.** Fixed, three equal cells, hairline top, blurred ground at 80%. The active cell takes a 5% ink fill and a 1px periwinkle line across its top edge. The `MADE WITH <3 BY BETICH.ME` line sits beneath the cells behind a fainter hairline — exactly the reference's arrangement. Content reserves `9rem` at the bottom so nothing is ever trapped under it.

**Three measures.** `max-w-3xl` for reading, `max-w-6xl` for the index and squoosh, `max-w-[1600px]` for the merge editor. A tool takes the narrowest measure that fits its work. The index sits at the middle measure because nine tiles at the widest one would each be a billboard.

**The editor skeleton.** Both tools resolve to settings / stage / inspector, collapsing to a single column in the order you would work in. Grid columns are `items-start`: a tall inspector must never stretch the stage, and a short stage must never leave a hole under it.

### Named Rules

**The Always-Reachable Rule.** Navigation is fixed at both ends of the viewport. On a 3000px editor page the next tool is one tap away from anywhere.

**The Work-Order Rule.** When columns stack, they stack in the order the work happens: set up, look, adjust.

## Elevation & Depth

There is exactly **one light source** — a fixed radial bloom at the top of the viewport, indigo at 40% fading through a dark halo to nothing by 68%. It sits behind everything at `z-0` and never moves or scrolls.

Nothing in the document flow casts a shadow. Two floating surfaces carry one, and it is the same one: `0 24px 60px -20px rgba(0,0,0,0.8)` — a deep, soft, offset drop that reads as distance from the panel, not as a halo. The lightbox keeps its own, heavier version over the scrim.

### Named Rules

**The One-Light Rule.** If you want something to feel raised, raise its ink alpha. Adding a second glow competes with the bloom and flattens the page.

## Shapes

- **0px** — every section rule, list divider, the snap guides, the bezel ticks. Rules are lines.
- **2px** — the toggle square.
- **6px** — form controls, the tooltip, popover rows.
- **8px** — the canvas stage frame.
- **16px** (`rounded-card`) — tool panels, dropzones, popovers, the toast, the password gate. The world's default container radius, taken from the reference.
- **999px** — chips, the status dot, circular icon buttons, the slider thumb.

**Borders** are 1px of ink at 12–16% alpha. A dashed border means one thing only: _this region is waiting for a file_.

## Components

### Top bar

Wordmark at `0.32em` tracking, and a status chip. The chip is a 6px dot plus a word: `API LIVE` in indigo with a 2.6s pulse when the server answers, `API OFFLINE` in hairline grey when it does not. It carries a tooltip naming exactly which features are affected.

### Bottom rail

Three equal cells, uppercase meta, with the active cell taking a 5% fill and a periwinkle top edge. The footer line sits under it and is the only place the product signs its own name.

### Bezel (signature component)

The index page's authored moment: track's compass bezel unrolled flat.

- **Construction:** two `repeating-linear-gradient` layers — minor ticks at 9px pitch, 16px tall, ink at 34%; major ticks at 72px pitch, 36px tall, ink at 70%. Gradients rather than SVG so the pitch stays constant and the strokes stay crisp at any width instead of compressing on a phone.
- **Ends:** faded with a `mask-image` from transparent to opaque at 22% and back at 78%, so the scale runs off the page rather than stopping at an edge.
- **Needle:** a 1px indigo rule at true centre, inside a 96px periwinkle radial glow at 22%, with a filled triangle north mark above it.
- **It is not decoration.** It carries the clock — stamped to the minute, refreshed every 20 seconds — and the count of tools on the bench.

### The bench (signature component)

The index is one grid of nine slots, three across, and every cell is the same size. The bench is the unit, not the card: a slot holds a tool, an idea, or nothing yet, and the difference between them is **state**, never weight.

- **Tool tile:** ground plus 3.5% ink behind a 12% hairline. Name in display type, blurb in Inter under it, then a hairline with the tagline and `OPEN →` beneath. The tagline sits below the rule on purpose — above the heading it would be an eyebrow.
- **Queued tile:** the same frame at 8% hairline with no fill, the name in headline type at 55% ink, and `QUEUED` where `OPEN →` would be. It is not a link and never lights up, because there is nothing behind it.
- **Empty slot:** the same frame at the full 12% hairline, empty but for a 6px dot of ink at 16% at its centre. It exists to say the bench is not full. Below `md` the grid drops to one or two columns and the empty slots are not drawn — an empty frame is a statement about a grid, and there is no grid on a phone.
- **Hover** (tool tiles only): the border moves to periwinkle at 45%, the fill lifts from 3.5% to 6%, the name turns periwinkle, the arrow translates 4px, and a 128px indigo wash rises from the floor of the tile over 500ms.
- **Keys:** `1`–`3` open the tools in slot order from the index.

### Saved list (mail merge)

Saved merges are a list, never a gallery: what separates two projects is a name and a timestamp, and a list puts both on one line. Each row is a hairline-separated two-line button — the name in normal tracking because the user typed it, the `YYYY.MM.DD HH:MM` stamp under it in meta — with the open arrow appearing on row hover and a delete button held to the right. The open project sits at full ink; everything else at 70% and periwinkle on hover.

**NEW opens a popover, not a blank document.** A name and an optional password, in the same panel-high surface the share menu uses. Empty password — the usual answer — means the merge stays local until it is saved; a password creates and locks it in one gesture, so a link that is going to a group is never briefly open.

**Delete is two taps, not a dialog.** The first tap arms the row and the icon turns periwinkle; the second deletes; three and a half seconds of silence disarms it. A modal would interrupt for something the user can simply not confirm.

### Form controls

Ground plus 4% ink, a 12% hairline, 6px radius, 8×10px padding, uppercase meta label above and sentence-case hint below. Hover raises the border to 28%; focus takes it to periwinkle and the fill to 6%. Focus removes the outline because the border is already the signal.

### Motion

One authored entrance — `resolve`: 14px rise, 8px blur, opacity to 1, over 700ms on `cubic-bezier(0.16, 1, 0.3, 1)`, staggered 90ms across the index's panels. State changes are 200–300ms colour transitions. The only looping animation in the product is the API dot's pulse, and everything is disabled under `prefers-reduced-motion`.

### Browser surfaces

Selection is indigo at 45% with full ink on top. The caret is periwinkle. Scrollbars are a 10px track with a pill thumb of ink at 14%, going periwinkle at 40% on hover, themed for both WebKit and Firefox. `color-scheme: dark` is declared so form controls and the scrollbar gutter come up dark before any CSS lands, and `#07071B` is inlined in the document head so the first paint is never white.

## Do's and Don'ts

### Do:

- **Do** write chrome in uppercase with the tracking for its size, and prose in sentence case.
- **Do** drop tracking to normal for anything the user typed.
- **Do** build raised surfaces out of ink alpha so the bloom shows through them.
- **Do** put a `tabular-nums` readout next to every slider.
- **Do** keep text at 0.55 ink alpha or higher; use the lower steps for hairlines only.
- **Do** say plainly when the server is unreachable, and keep both tools working without it. A panel that needs the API says so in its own body, in meta, and the editor carries on around it.
- **Do** take the undo snapshot on gesture start, so a drag is one step.

### Don't:

- **Don't** add a third hue, a status colour, or a coloured disabled state.
- **Don't** put a shadow on anything that is in the document flow.
- **Don't** add a second glow, gradient wash, or light source to compete with the bloom.
- **Don't** put a label line above a heading. If it matters, it goes below the rule.
- **Don't** number a sequence unless the number is data the reader needs.
- **Don't** use italic to mean "here" — it disappears on this ground. Use ink and the underline.
- **Don't** set prose in mono or chrome in Inter.
- **Don't** let a fixed bar overlap content; reserve the space instead.
