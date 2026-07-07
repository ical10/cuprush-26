# CupRush 26 Brand Toolkit Plan

## Goal

Create the design context Impeccable needs to evolve the existing mobile fan game under the working name **CupRush 26**.

The brand should make fans feel immediate FOMO, match-day excitement, fierce loyalty, and pre-victory confidence. It may borrow broad cues from cyberpunk and major international football events, but it must not imitate FIFA's protected trophy, emblem, typography, slogans, or official lockups.

## Approved direction to encode

- Product: mobile-first 2026 football prediction game
- Audience: casual football fans arriving through shared links or QR codes
- Personality: electric, triumphant, passionate, inclusive
- Visual territory: neon match-night futurism with strong football-team energy
- Avoid: betting/casino language, crypto aesthetics, dystopian grime, generic gaming purple, protected tournament branding
- Working name: **CupRush 26**
- Working rally line: **The match is live. Make your call. Be the winner.**

## Deliverables

1. `PRODUCT.md`
   - Audience, purpose, positioning, voice, brand/product register, accessibility, references, and anti-references
   - Strategic context only; no visual tokens

2. `DESIGN.md`
   - Identity and lockup rules
   - Original color system, typography, spacing, shape, iconography, imagery, states, and accessibility rules
   - Fundamental component rules for swipe decks, navigation, buttons, dialogs, sheets, popovers, forms, feedback, live cards, results, and leaderboards
   - A reusable stadium-motion language for future animation work
   - Explicit copyright/trademark distance from the official 2026 tournament identity
   - Guidance tied to current React screens and CSS tokens

3. `.claude/brand-voice-guidelines.md`
   - LLM-ready voice, tone-by-context, terminology, microcopy patterns, examples, confidence scores, and open questions

4. `brand/cuprush-26-toolkit.png`
   - One review plate showing the wordmark direction, palette, type, icon language, UI application, and social/share tile

## Sequence

1. Draft the strategic and visual documents from the README, PRD, current UI, user interview, and Impeccable guidance.
2. Generate the toolkit plate from those approved written decisions.
3. Review all artifacts for internal consistency, accessibility, originality, and implementation usefulness.
4. Make no application-code or dependency changes in this task.

## Validation

- `PRODUCT.md` contains strategy only; `DESIGN.md` owns visual decisions.
- Palette combinations used for text meet WCAG AA.
- The toolkit contains no FIFA wordmark, trophy silhouette, official slogan, copied emblem, or lookalike lockup.
- Every proposed UI token maps cleanly to the existing CSS architecture.
- Brand voice stays celebratory without implying wagering, prizes, or guaranteed outcomes.
- The final handoff records the review verdict.

## Sources

- `README.md`
- `plans/PRD.md`
- Current `src/web` implementation
- User discovery answers from 2026-07-06
- Impeccable `init`, `shape`, and Designing guidance
- FIFA's public description of the official 2026 identity, used only to define safe distance
