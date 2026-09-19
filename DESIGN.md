---
name: betich's tools
description: A workshop bench after dark — the betich.me voice taken into track.betich.me's instrument panel.
extends: track.betich.me
colors:
  ground: "#04040D"
  bloom: "#07071A"
  panel: "#0B0B1A"
  panel-high: "#101026"
  ink: "#F6F5FF"
  prose: "rgba(246,245,255,0.88)"
  prose-muted: "rgba(246,245,255,0.80)"
  label: "rgba(246,245,255,0.76)"
  meta: "rgba(246,245,255,0.64)"
  surface: "rgba(246,245,255,0.04)"
  surface-high: "rgba(246,245,255,0.07)"
  control: "rgba(246,245,255,0.045)"
  edge: "rgba(246,245,255,0.34)"
  hairline: "rgba(246,245,255,0.24)"
  wash: "rgba(246,245,255,0.16)"
  hairline-faint: "rgba(246,245,255,0.10)"
  hover-wash: "rgba(246,245,255,0.07)"
  periwinkle: "#C3C2FA"
  signal: "#5A57F0"
  scrim: "rgb(2 2 8 / 0.94)"
typography:
  hero:
    fontFamily: "Roboto Mono, Sarabun, monospace"
    fontSize: "clamp(3rem, 6.4vw, 7.25rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    case: upper
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

The voice did not change — Roboto Mono still carries every piece of structure, Inter still appears only inside running prose, and Thai is still covered by Sarabun so it never falls back mid-sentence. What changed is the room the lights are on in. The ground is `#04040D` — near-black, with only a trace of indigo left in it — and ink is `#F6F5FF`, a lavender white held at four alpha steps rather than mixed into four separate greys. One bloom of light sits behind the top of the page, tight and low enough to have resolved by the fold, and everything else is flat. Nothing casts a shadow, because nothing here is made of paper.

The room is deliberately darker than the reference, and the ink is deliberately brighter in it. Contrast is the whole point of an instrument panel: a hairline has to read as a line rather than a smudge, and a micro-label at 11px has to survive being glanced at. Every step of the ramp clears 7:1.

The reference is [track.betich.me](https://track.betich.me), which is the same person's work in the same typeface solving a different problem: a compass, a map, a status line, a tab bar. Its conventions are adopted wholesale — the uppercase wide-tracked labels, the single status dot, the fixed rail across the floor of the screen, the `MADE WITH <3 BY BETICH.ME` line under it. A visitor arriving here from there should not have to learn a second system.

**Key Characteristics:**

- Structure is uppercase mono with wide tracking: `0.18em` at 11px, `0.1em` at 12px, `0.22em` on a page title. Sentence case begins at the first paragraph of prose and nowhere earlier.
- Two accents with different jobs: periwinkle `#B9B8EF` is where an interactive element _arrives_, indigo `#4845DA` means _live_ — the status dot, the needle, the wash under a panel you are about to open.
- Depth is alpha, not elevation. A raised surface is the ground plus 4% ink; a hairline is the ground plus 10–24%.
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

- **Ground** (`#04040D`): The universal page background, set on `html` as well as `body` so an overscroll never flashes white.
- **Bloom** (`#07071A`): The checkerboard's base, and the colour the bloom resolves toward.
- **Panel / Panel High** (`#0B0B1A` / `#101026`): The two floating surfaces — the font picker popover, the share dialog, the tooltip and the toast. Nothing in the document flow uses them; in-flow surfaces are an alpha of ink instead, so they inherit whatever is behind them.

### Ink

A single colour at four steps. Contrast was measured against the ground, not assumed:

| token       | alpha | contrast | use                                                |
| ----------- | ----- | -------- | -------------------------------------------------- |
| ink         | 1.00  | 18.9:1   | values, headings, the active tab, a selected layer |
| prose       | 0.88  | 14.5:1   | running prose in a panel                           |
| prose-muted | 0.80  | 11.9:1   | the index's standfirst                             |
| label       | 0.76  | 10.8:1   | field values, list rows, tool blurbs               |
| meta        | 0.64  | 7.7:1    | every uppercase micro-label, status, counters      |

**0.64 is the floor for text**, and it clears AA for body copy rather than merely for large type. Below it the ramp is structure only — `edge 0.34`, `hairline 0.24`, `wash 0.16`, `hairline-faint 0.10` — and none of those ever carries a glyph.

### Surfaces

Three fills, all of them ink over the ground, so everything in the document flow stays transparent to the bloom.

| token        | alpha | use                                                        |
| ------------ | ----- | ---------------------------------------------------------- |
| surface      | 0.040 | a tile, a card, a panel that has risen off the ground      |
| control      | 0.045 | the inside of an input, a select, a segmented control      |
| surface-high | 0.070 | that surface hovered, the active rail cell, a chosen page  |

### Accents

- **Periwinkle** (`#C3C2FA`): The destination. Hover, focus, the active underline, the selection box on the canvas, the caret, the slider thumb's edge.
- **Signal** (`#5A57F0`): Life. The API dot when the server answers (and only then — it also gets the slow pulse), the bezel needle, the wash that rises inside a tool panel on approach, and the text selection background.

### Named Rules

**The Two-Job Rule.** Periwinkle is where you _arrive_; indigo means something is _live_. An element that cannot be acted on never sits in periwinkle, and an element that is merely hovered never turns indigo.

**The Alpha-Depth Rule.** A surface in the document flow is the ground plus an alpha of ink. Solid panel colours belong only to things that float above the page. This is why the layout survives the bloom: everything in flow is transparent to it.

**The No-Status-Colour Rule.** No green success, no red error, no amber warning. A failed job states what went wrong in meta-grey; a compression that saved bytes is periwinkle because it is good news, not because it is a "success state". Direction is carried by the sign on the number.

## Typography

**Structure:** Roboto Mono (400/500/700, plus 400 italic), backed by Sarabun so Thai never falls back.
**Prose:** Inter, backed by IBM Plex Thai.

**Character:** The reference reads like a field instrument — everything labelled, everything measured, nothing decorated. Uppercase with open tracking is what makes a 11px mono label legible at a glance and is the single strongest signal that this is the same family of sites as track.

### Hierarchy

- **Hero** (700, `clamp(3rem, 6.4vw, 7.25rem)`, `-0.035em`, upper, line-height 0.92): a tool's name on its door on the index. Nowhere else.
- **Display** (700, 24px, `0.02em`, upper): reserved for live things at panel scale.
- **Headline** (700, 18px, `0.08em`, upper): a secondary tool panel's name.
- **Title** (700, 15px, `0.22em`, upper): the page heading, and the wordmark at `0.32em`. Page titles are small and widely tracked; the site does not shout its own name.
- **Body** (400, 14px/1.71, Inter, sentence case): the only sentence-case text in the product. Measure is capped at `62ch` on the index and `46ch` inside a panel.
- **Label** (400, 12px, `0.1em`, upper): what a control holds. Values the user typed drop tracking to normal, because a filename or a hex code is not a label.
- **Meta** (400, 11px, `0.18em`, upper): every micro-label, status line, counter and hint. The workhorse.

### Named Rules

**The Tracking-Rises-As-Size-Falls Rule.** `0.22em` at 15px, `0.18em` at 11px, `0.1em` at 12px, normal for user-entered values, and negative only at hero size (`-0.035em`), where the mono's own spacing is already wide. Tracking is how this system adds formality; weight is reserved for hierarchy.

**The Sentence-Case Boundary.** Chrome is uppercase. Prose is sentence case. There is no third register, and a hint under a field is prose.

**The Typed-Value Rule.** Anything the user typed or the machine produced — a filename, a hex value, a layer's text, a font family — renders with normal tracking so it can be read as data rather than as a label.

## Layout

**Top bar.** Sticky, hairline bottom, `backdrop-blur-xl` over the ground at 70% so content dissolves under it rather than colliding. Wordmark left, API state right.

**Bottom rail.** Fixed, three equal cells, hairline top, blurred ground at 80%. The active cell takes a 7% ink fill and a 1px periwinkle line across its top edge. The `MADE WITH <3 BY BETICH.ME` line sits beneath the cells behind a fainter hairline — exactly the reference's arrangement. Content reserves `9rem` at the bottom so nothing is ever trapped under it.

**Three measures and a room.** `max-w-3xl` for reading, `max-w-6xl` for squoosh, `max-w-[1600px]` for the index and any wide page. A tool takes the narrowest measure that fits its work — except the merge editor, which from a laptop up is not a page at all but a room (below). The index takes the widest measure on purpose: its two doors are meant to be billboards.

**The editor skeleton.** Both tools resolve to settings / stage / inspector.

**The merge editor is a room.** From 1024 up it takes exactly the viewport between the top bar and the rail (`Shell width="workspace"`, which lays the rail out as the room's last row instead of floating it), and the page never scrolls. A toolbar row carries `MAIL MERGE / <document name>` and the share state on the left, `SAVE · SHARE` and the solid `EXPORT` button on the right. Beneath it, three panes separated by faint hairlines: the merge on the left (projects, document, base image, layers, data), the poster alone in the middle at every pixel it can take, the selected layer on the right. **Each side pane scrolls on its own** (`overflow-y: auto`, `overscroll-behavior: contain`); the poster never moves. Output settings do not live in the room — they live in the export sheet, where the output is.

| from | columns | stage |
| ---- | ------- | ----- |
| 1536 | 320 / 1fr / 344 | fills the middle pane |
| 1280 | 296 / 1fr / 320 | fills the middle pane |
| 1024 | 248 / 1fr / 272 | fills the middle pane |
| 768 | a scrolling page: stage across the top, then settings \| inspector (`items-start`) | 54vh, max 540 |
| phone | a scrolling column, the stage pinned | 38vh, max 300 |

**The phone is a different editor, not a narrower one.** The stage sticks under the top bar at `top-12` and a two-cell strip — `SET UP · LAYER`, in the rail's own language (export is the toolbar's button) — swaps what sits beneath it. You are always looking at the artwork while you change it, and switching cells scrolls you to the top of the new one. The stage's wrapper is `display: contents` below `md` so the canvas becomes a child of the page column: sticky inside a one-row grid has nowhere to travel.

Touch gets its own sizes where it needs them: the layer's resize handle goes from 10px to 16px under `pointer: coarse`, and the pane cells are 46px tall.

### Named Rules

**The Always-Reachable Rule.** Navigation is fixed at both ends of the viewport. On a 3000px editor page the next tool is one tap away from anywhere.

**The Work-Order Rule.** When columns stack, they stack in the order the work happens: set up, look, adjust.

## Elevation & Depth

There is exactly **one light source** — a fixed radial bloom at the top of the viewport, indigo at 26% over a 64%-wide ellipse, fading through a dark halo to nothing by 64%. It sits behind everything at `z-0` and never moves or scrolls. It is small and low on purpose: a wide, bright bloom lifts the whole upper page toward the ink and costs the chrome its contrast.

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

Three equal cells, uppercase meta, with the active cell taking a 7% fill and a periwinkle top edge. The footer line sits under it and is the only place the product signs its own name.

### Bezel (signature component)

The index page's authored moment: track's compass bezel unrolled flat.

- **Construction:** two `repeating-linear-gradient` layers — minor ticks at 9px pitch, 16px tall, ink at 34%; major ticks at 72px pitch, 36px tall, ink at 70%. Gradients rather than SVG so the pitch stays constant and the strokes stay crisp at any width instead of compressing on a phone.
- **Ends:** faded with a `mask-image` from transparent to opaque at 22% and back at 78%, so the scale runs off the page rather than stopping at an edge.
- **Needle:** a 1px indigo rule at true centre, inside a 96px periwinkle radial glow at 22%, with a filled triangle north mark above it.
- **It is not decoration.** It carries the clock, stamped to the minute and refreshed every 20 seconds. Nothing else is written under it.

### The doors (signature component)

The index says nothing it does not have to. Under the bezel there is one door per live tool — two across from a laptop up, stacked below — and nothing else: no introduction, no queue of ideas, no empty slots. A tool is shown, not described.

- **Name:** the `hero` step — Roboto Mono bold, `clamp(3rem, 6.4vw, 7.25rem)`, line-height 0.92, tracking `-0.035em`. The one place in the product where type is the image; tracking tightens here because at this size the mono's own spacing is already wide. It turns periwinkle on approach.
- **Drawing:** each door carries its tool's own interface doing its own job, in ink alphas only, with periwinkle reserved for the part that moves. *squoosh* is its compare slider across a lit sphere — smooth on the `ORIGINAL` side, blocked into 15px cells and five bands on the `WEBP` side; on approach the divider slides from 50% to 28%. *mail merge* is a stack of the same poster carrying the editor's own sample rows; on approach it deals itself out into three. Both move over 700ms on the house ease and stand still under reduced motion.
- **Footer:** a hairline, the tool's tagline in meta, `OPEN →`. That is all the copy a door has.
- **Frame:** ground plus 4% ink behind a 16% hairline, 16px radius. From a laptop up a door is `min(100dvh − 21.5rem, 44rem)` tall so both fit above the rail without scrolling.
- **Hover:** the border moves to periwinkle at 45%, the fill lifts from 4% to 7%, the name turns periwinkle, the arrow translates 4px, and a 160px indigo wash rises from the floor of the door over 500ms.
- **Keys:** `1`–`3` open the tools in slot order from the index.

### Saved list (mail merge)

Saved merges are a list, never a gallery: what separates two projects is a name and a timestamp, and a list puts both on one line. Each row is a hairline-separated two-line button — the name in normal tracking because the user typed it, the `YYYY.MM.DD HH:MM` stamp under it in meta — with the open arrow appearing on row hover and a delete button held to the right. The open project sits at full ink; everything else at 70% and periwinkle on hover.

**Every project is listed, locked ones included.** A lock guards the contents, not the fact that the project exists: a locked row carries a 12px lock glyph after its name and asks for the password when opened. A row with a link carries a copy-link icon beside delete, so a link is one click from the shelf — the icon is the "shared" marker; there is no status word.

**NEW opens a popover, not a blank document.** A name and an optional password, in the same panel-high surface the share dialog uses. Empty password — the usual answer — means the merge stays local until it is saved; a password creates and locks it in one gesture, so a link that is going to a group is never briefly open.

**Delete is two taps, not a dialog.** The first tap arms the row and the icon turns periwinkle; the second deletes; three and a half seconds of silence disarms it. A modal would interrupt for something the user can simply not confirm.

### Align cluster (mail merge)

Six moves in one bordered strip, arranged the way every canvas editor arranges them: the horizontal trio, a 16px rule, then the vertical trio. The glyphs are authored rather than borrowed — a 1px rule for the edge you are aligning to and two bars moving onto it — so they carry the same hairline weight as the panel around them.

**A button that is already true reads as pressed.** When the layer is flush to that edge the cell takes the 7% fill and full ink, which makes the cluster a readout as well as a control. Every press is one commit, so every press is one undo.

### Export sheet (mail merge)

A full-bleed surface, portalled above the chrome, that replaces "render everything and hope": every row as a thumbnail, the ones you want picked by clicking them, and the format decided beside the grid.

- **The pages.** A responsive grid of cards at the document's own aspect ratio over the checkerboard. The artwork is never dimmed — a preview that lies about the output is worthless — so selection is carried by the frame, a tick in the corner, and the file name going to full ink.
- **Rendering.** Thumbnails fill in one row per frame with a yield between them, and the header counts them up in periwinkle while it happens. A 500-row merge fills progressively instead of freezing the tab.
- **The panel.** Format, quality (disabled and explained under png), and the file-name pattern. It states what will land — `12 jpg files · one zip` — directly above the solid `DOWNLOAD` button, bottom-right where the eye finishes. Under a hairline beneath it sits the other way out: one sentence of prose and an outline `RENDER ALL ON SERVER`, which has the api draw every row into one zip.
- **Escape closes it**, unless a render is running.

### Data section (mail merge)

**One obvious action per state.** Empty, the action is loading a sheet: an outline `CHOOSE A SHEET` button inside the dashed drop target, and the sample offered under it in prose as the way to try the tool without a file. Loaded, the action is adjusting the row on the poster: the current row is a card whose values each open the row editor, with `EDIT ROW 02` across its foot. Reload, replace, the list of every row and the timeline sit below it, quieter.

**Reload is a step, not a reset.** `RELOAD` re-reads the same file without asking where the browser can hold a file handle, and opens the picker elsewhere; dropping a file on the loaded section does the same. The old rows are kept inside the step, so a reload rolls back like any edit.

**A severed column says so.** When the template asks for a column the sheet does not have, an edge-bordered block names the tokens in prose and offers `MATCH COLUMNS`. There is no warning colour: the block is ink, the icon is ink, and the button is the only way out.

### Row editor (mail merge)

A panel-high popover that docks beside the left pane, over the edge of the stage, so the poster it is changing stays in view; below `md` it is a sheet across the foot of the screen under the pinned stage. Every keystroke is drawn on the canvas as a draft. A changed field turns its label periwinkle, takes a periwinkle border, and shows `WAS` and the old value struck through, with a put-back glyph. `↵` applies, shift-`↵` breaks the line, escape discards, and a click outside keeps what was typed, because the timeline is the safety net. The header's arrows apply and move to the neighbouring row. Delete row is two taps.

### Edit timeline (mail merge)

Saved with the merge, newest first, at most 24 steps: a 1px rule running down through a 7px node per step, the newest filled, and a diamond marked `AS LOADED` at the foot. Each step says exactly what changed: the field, the old value struck through, the new one. `ROLL BACK` undoes a step and everything above it; pointing at it strikes through exactly the steps that would go and hollows their nodes in periwinkle, and it is two taps like delete (`UNDO 03?`).

### Match columns (mail merge)

The share dialog's frame at 38rem, laid out in two columns: `TEMPLATE ASKS FOR` on the left (each token as a chip, dashed until matched), `SHEET COLUMN` on the right (a select, pre-filled with a guess only when the names are close, and the column's first value underneath so `name` can be told from `nickname`). Applying rewrites the template's tokens to the sheet's names, so the next reload of the same file matches without asking, and records a step that rolls back with the reload that caused it.

### Button

The one action a surface exists for gets a real button: 36px tall, 6px radius, uppercase meta in bold. **Primary** is solid ink with ground-coloured text — the only solid-ink shape in the chrome, so it is found without reading — and arrives at periwinkle on hover. **Outline** is a 34% edge with ink text for the second-best action. Everything else stays a text button. There is one primary per surface: `EXPORT` in the editor, `DOWNLOAD` in the export sheet, `COPY LINK` (or `CREATE LINK`) in the share dialog.

### Share dialog (mail merge)

Sharing is shaped the way a file is shared. A floating panel-high card, 34rem wide, over a 72% scrim: `SHARE <name>` and a close glyph, then the **link** as a read-only field in typed-value tracking with a solid `COPY LINK` beside it (it flips to `✓ COPIED` for 1.8s and announces it politely), then **general access** as two rows — `ANYONE WITH THE LINK · can open and edit` and `LOCKED · needs a password to open, edit or delete` — each a 28px circled glyph plus a mono title and a line of prose. The chosen row takes the 7% fill and a periwinkle ring.

Opening to anyone applies at once, as choosing it in a menu would. Locking waits for a password in an inline field with an outline `LOCK` (`CHANGE` when already locked). A merge with no link yet says so in prose and offers `CREATE LINK`, which saves, mints with the chosen access, and copies in one gesture. Both kinds of access edit the same document, and the footer says so. Escape and a click on the scrim close it; focus returns to whatever opened it.

### Form controls

Ground plus 4.5% ink, a 16% hairline, 6px radius, 8×10px padding, uppercase meta label above and sentence-case hint below. Hover raises the border to 34%; focus takes it to periwinkle and the fill to 7%. Focus removes the outline because the border is already the signal.

### Motion

One authored entrance — `resolve`: 14px rise, 8px blur, opacity to 1, over 700ms on `cubic-bezier(0.16, 1, 0.3, 1)`, staggered 90ms across the index's panels. State changes are 200–300ms colour transitions. The only looping animation in the product is the API dot's pulse, and everything is disabled under `prefers-reduced-motion`.

### Browser surfaces

Selection is indigo at 50% with full ink on top. The caret is periwinkle. Scrollbars are a 10px track with a pill thumb of ink at 20%, going periwinkle at 45% on hover, themed for both WebKit and Firefox. `color-scheme: dark` is declared so form controls and the scrollbar gutter come up dark before any CSS lands, and `#04040D` is inlined in the document head so the first paint is never white.

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
