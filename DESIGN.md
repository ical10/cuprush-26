<!-- SEED: Direction approved for implementation; refresh with /impeccable document after the visual system lands in code. -->

# CupRush 26 Design System

## 01 Overview

**Creative North Star: Night Stadium Ignition.** The instant floodlights hit, the crowd rises, and a fan commits to a call before doubt catches up.

CupRush 26 combines the discipline of a modern football kit with the voltage of a future match broadcast. Dark pitch tones create focus. Electric accents signal decisions and live events. Condensed type delivers chants and scores; a quieter grotesk keeps controls readable.

The app defaults to the product register. Keep one primary action, stable navigation, compact status information, and obvious outcomes. Brand surfaces may enlarge the wordmark, type, and rush-line graphics.

Use a 4px base spacing unit. Prefer `4, 8, 12, 16, 24, 32, 48, 64`. App content stays within 480px and respects device safe areas.

Use clipped corners as the signature shape: a rectangular surface with one 8px diagonal cut or notch. Do not clip every edge. Use `8px` for controls, `12px` for compact panels, and `20px` for hero cards. Reserve pills for live or status badges.

Motion expresses cause and effect:

- Pick: card commits in 220–320ms with a short directional exit.
- Confirmed: one cyan edge sweep, then stillness.
- Live stat change: one 450ms pulse on the affected value only.
- Result: one decisive scale-and-settle motion, never confetti by default.
- Reduced motion: replace travel and scale with an immediate state change or short opacity fade.

Identity lockup: set `CUPRUSH` in uppercase condensed black type, followed horizontally by a separated `// 26` tab. Keep `26` on one line. Never place a trophy, cup silhouette, globe, or football between stacked numerals. The optional symbol is an original forward-cut `CR` monogram; do not use it until it remains recognizable at 24px.

## 02 Colors

### Core palette

| Token | Name | Hex | Use |
|---|---|---:|---|
| `--bg` | Floodlight Black | `#07120D` | Page and app background |
| `--surface` | Night Pitch | `#10231A` | Primary cards and navigation |
| `--surface-raised` | Tunnel Green | `#183427` | Raised controls and secondary panels |
| `--text` | Stadium White | `#F4FFE8` | Primary text on dark colors |
| `--text-dim` | Mist Grey | `#9CB0A4` | Secondary text on Floodlight Black or Night Pitch |
| `--accent` | Rush Lime | `#D7FF3F` | Primary action, selection, focus, wordmark accent |
| `--live` | Victory Cyan | `#19F5D2` | Live, confirmed, and currently-ahead states |
| `--danger` | Pressure Coral | `#FF5B6E` | Error, currently-behind, destructive confirmation |
| `--warning` | Whistle Amber | `#FFC857` | Locking soon, delayed, attention |
| `--border` | Line Green | `#315343` | Borders and dividers on dark surfaces |

When implementation begins, rename the current `--surface-2` token to `--surface-raised`; they represent the same role. Replace the existing Discord-derived values in place rather than adding a parallel palette.

### Usage rules

- Use Stadium White on dark surfaces for body copy.
- Use Floodlight Black for text on Rush Lime, Victory Cyan, and Whistle Amber.
- Use Floodlight Black on Pressure Coral; use Pressure Coral itself for text only on Floodlight Black.
- Keep Rush Lime to roughly 10% of an app screen. It marks decisions, not decoration.
- Victory Cyan means live, confirmed, or ahead. It does not replace Rush Lime as the main CTA.
- Pair semantic color with an icon and plain label.
- Gradients are rare. The only approved gradient runs `#D7FF3F` to `#19F5D2` on large brand artwork, never behind body copy or inside routine controls.
- Do not add purple, royal blue, metallic gold, or team colors to the core UI. Team colors may appear as small data accents when a trusted data source supplies them accurately.

## 03 Typography

### Families

- **Display:** `"Barlow Condensed", "Arial Narrow", sans-serif`
- **Interface:** `"Manrope", system-ui, -apple-system, "Segoe UI", sans-serif`
- **Data:** `"Manrope", system-ui, sans-serif` with tabular numerals

Barlow Condensed carries the wordmark, rally lines, scores, ranks, and short card questions. Manrope carries controls, body copy, disclosures, and longer team names.

### Scale

| Role | Size / line | Weight | Rules |
|---|---|---:|---|
| Display XL | `56/52` | 800 | Brand surfaces only; uppercase optional |
| Display L | `40/40` | 800 | Result and campaign headlines |
| Screen title | `30/32` | 800 | One per screen |
| Card question | `26/30` | 700 | Sentence case; maximum three lines when possible |
| Score | `36/36` | 800 | Tabular numerals |
| Body | `16/24` | 500 | Default copy |
| Label | `14/18` | 700 | Buttons and status labels |
| Meta | `12/16` | 600 | Use sparingly; never below 12px |

Use tight tracking only on display text. Use `0.04em` tracking for uppercase labels. Do not use faux italics, outlined body text, gradient text, or more than two font families.

## 04 Elevation

The system is mostly flat. Hierarchy comes from color, border, scale, and one clipped edge—not stacks of shadows.

- Base surfaces: no shadow, 1px Line Green border.
- Interactive cards: `0 10px 30px rgb(0 0 0 / 24%)` only while draggable or focused.
- Dialogs: `0 18px 60px rgb(0 0 0 / 42%)` with a solid Floodlight Black scrim.
- Selected controls: 2px Rush Lime border plus a 3px outer focus ring with sufficient offset.
- Live or confirmed state: a Victory Cyan edge or icon, not a permanent glow.

Never use glassmorphism, frosted panels, multiple nested shadows, neon halos around every element, or elevation to imply a disabled state.

## 05 Components

### App shell and navigation

Keep the shell centered and mobile-first. The header uses the compact horizontal `CUPRUSH // 26` lockup. Bottom navigation stays stable, respects the safe area, and pairs concise labels with simple outline icons. The active item uses Rush Lime plus a visible top edge; inactive items use Mist Grey.

### Prediction card

The card is the hero. Use Night Pitch, a 20px radius, one clipped top-right corner, a 2px border, and generous vertical space. Place fixture metadata above the question. The draggable card contains the fixture, question, and directional swipe cues only—never outcome buttons.

Add a restrained diagonal rush-line motif behind empty card space at no more than 8% opacity. Never place decorative texture behind the question.

### Swipe deck

Show one active card, with at most two offset cards behind it to imply momentum. The active card owns pointer and keyboard input. Treat swiping as the primary mechanism. Place the button fallback in a visually separate action rail below the deck so it never moves, rotates, or exits with the card.

- Dragging left previews `No` or `Lower`; dragging right previews `Yes` or `Higher`.
- Reveal the outcome label and semantic color only after the card crosses the decision threshold.
- Return sub-threshold drags to center without changing the answer.
- Disable the deck while a pick saves; keep its current state visible.
- Keep card position, labels, and button order synchronized for left-to-right and right-to-left layouts.
- Reduced motion removes rotation and long travel; use an immediate card replacement with a short fade.

The secondary action rail uses two equal-width, neutral secondary buttons: `No/Lower` on the left and `Yes/Higher` on the right. Keep an 8–12px gap between the deck and rail. Use quieter contrast than the card and reveal semantic color only during hover, focus, press, or a committed answer.

### Buttons

- Primary: Rush Lime background, Floodlight Black text, 8px radius, strong label.
- Secondary: Tunnel Green background, Stadium White text, Line Green border.
- Live/confirmed: Victory Cyan treatment only after the action resolves.
- Destructive: Pressure Coral, reserved for irreversible account actions.
- All buttons: minimum 44px height, visible focus, pressed state through 2px translation or color shift.

Use verbs: “Make the call,” “Lock my pick,” “Share result.” Avoid “Submit,” “Continue,” and “OK” when a specific action exists.

### Status badges

Use compact pills only for `LIVE`, `LOCKING`, `LOCKED`, `SETTLING`, `PUSH`, and `VOID`. Include an icon or shape change. Live may use a small pulsing dot unless the fan enables reduced motion.

### Dialogs, sheets, and popovers

Use a centered dialog for short confirmations and irreversible actions. Use a bottom sheet on mobile when the fan needs context while keeping the match or card visible. Use popovers only for brief, non-critical explanations anchored to a control.

- Dialogs trap focus, close on `Escape`, restore focus to the trigger, and label the close control.
- Bottom sheets respect safe areas and never exceed 90% of viewport height.
- Keep one primary action and one clear secondary action. Place destructive actions last and label the consequence.
- Use a solid dark scrim at 70%; never blur the match into decorative glass.
- Do not open a popup for routine success. Confirm the action inline or with a brief status message.

### Forms and account controls

Inputs use Night Pitch, a Line Green border, 8px radius, and a persistent label. Rush Lime marks focus; Pressure Coral marks an error with an icon and message. Keep wallet disclosures and account deletion language in body text, never fine print.

### Feedback and loading

Prefer inline feedback beside the action it describes. Use a toast only for background or cross-screen events; keep it visible long enough to read and expose the same message to assistive technology. Skeletons match the final layout and never pulse under reduced motion. Spinners accompany a verb such as “Saving your pick,” never stand alone.

### Live card

Promote the current score or stat comparison above explanatory copy. Show “Ahead” or “Behind” beside the arrow so color never carries meaning alone. Animate only the value whose event sequence changed.

### Result card

Lead with the result phrase, then the question, streak, and next action. Correct results use Victory Cyan; incorrect results use Pressure Coral without shaming language. The sponsor slot stays visually subordinate and never resembles a CTA.

### Leaderboard

Use tabular numerals, fixed rank width, and one highlighted “you” row. The top three may gain a single angular rank tab. Do not use gold/silver/bronze gradients, podium illustrations, or dense statistics.

Keep the header row visible during long lists. Each row shows rank, fan name, points, and current streak in a stable grid. Truncate only after preserving an accessible full name. Rank changes may slide once after fresh data arrives; they must not reorder repeatedly while the fan reads.

### Stadium motion layer

Build atmosphere from a small set of reusable event motions, not permanent background animation:

- **Kickoff:** one floodlight sweep across the shell when a fixture becomes live.
- **Card commit:** directional exit plus a short edge streak tied to the chosen side.
- **Live swing:** affected score or stat pulses once; an “Ahead” or “Behind” label updates with it.
- **Rank rise:** the fan row moves to its new slot and settles with a Rush Lime edge flash.
- **Correct call:** a restrained crowd-light burst behind the result card, then stillness.
- **Dialog entry:** 160ms opacity and 8px rise; no bounce on serious confirmations.

Keep routine transitions between 160ms and 320ms. Reserve up to 600ms for a result reveal. Motion never delays input, loops without meaning, moves unrelated components, or relies on audio. Later stadium effects must use these events rather than introduce a second motion language.

### Empty, delayed, and error states

Name what happened, preserve the fan’s confidence, and provide one next action. Use a simple line icon; never use generic sad illustrations.

### Icon and imagery language

Use 2px rounded line icons with one angular cut. Prefer whistle, floodlight, flag, pulse, arrow, shield, and scoreboard forms. Avoid trophy silhouettes, official tournament shapes, coins, wallets, chains, rockets, lightning-bolt clichés, and national stereotypes.

When photography appears, show supporter faces, scarves, hands, and floodlit atmosphere. Use original or licensed images. Add high-contrast duotone crops in Floodlight Black plus one accent; do not imitate official tournament portrait treatments.

## 06 Do's and Don'ts

### Do

- Make the next decision obvious within one glance.
- Use Rush Lime for commitment and Victory Cyan for live confirmation.
- Keep the `CUPRUSH // 26` lockup horizontal and original.
- Let clipped geometry and condensed type carry the future-football character.
- Celebrate brave calls before final results.
- Show match, network, and settlement states in plain language.
- Test 60-character team names, localization, offline mode, 500 errors, and delayed settlement.
- Preserve buttons alongside swipe gestures and honor reduced motion.

### Don't

- Do not use FIFA, World Cup, official marks, trophy imagery, official slogans, or a lookalike trophy-and-year structure in the identity.
- Do not imply affiliation, endorsement, cash winnings, odds, or guaranteed success.
- Do not make Solana, wallets, chains, or tokens the visual story.
- Do not cover routine screens in glow, gradients, grids, scanlines, or glitch effects.
- Do not add decorative cards where grouping, spacing, or a divider will work.
- Do not use tiny uppercase copy for explanations.
- Do not animate every live update or punish a wrong prediction.
- Do not use generic purple gaming themes or copy team crests and kit graphics.
