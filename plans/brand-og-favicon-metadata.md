# Plan: brand OG image, favicon, PWA icons, social metadata

## Assets (codex image_gen for photo art; hand-authored SVG for marks)

- **OG image** `public/og.jpg` 1200x630 ≤300KB: night-stadium brand art
  (floodlights, Floodlight Black tint) with the `CUPRUSH // 26` lockup +
  rally line overlaid IN CODE (canvas/sharp/manual compositing) or generated
  text-free and composited — text must be crisp, never AI-rendered type.
  Approved lime→cyan gradient allowed (large brand artwork only).
- **Favicon** `src/web/public/favicon.svg`: hand-authored SVG — lime `//26`
  tab or forward-cut CR monogram per DESIGN.md (only if readable at 24px;
  else `//26`). Dark bg tile + Rush Lime mark. No photo, no raster.
- **PWA icons**: 192/512 + maskable 512 PNGs from the same mark (solid
  Floodlight Black bg, generous safe zone), wired into the vite-plugin-pwa
  manifest.

## Metadata (src/web/index.html + vite config manifest)

- `<meta name="description">`, `og:title` ("CupRush 26 — Make your call"),
  `og:description` (rally line), `og:image` (absolute:
  https://app-production-8a6b.up.railway.app/og.jpg), `og:type`,
  `og:url`, `twitter:card=summary_large_image` + twitter title/desc/image.
- Manifest icons array updated; theme colors already correct.

## Identity rules (binding)

- Lockup: horizontal `CUPRUSH // 26`, `26` one line, no trophy/globe/ball.
- Anti-refs: no FIFA marks, no coins/wallets, no purple gradients.
- Palette only: #07120D/#10231A/#D7FF3F/#19F5D2/#F4FFE8.

## Verify

- Vite serves /favicon.svg + /og.jpg from public dir (check root config:
  vite root is src/web — public dir is src/web/public).
- `pnpm build` → assets in dist/client; manifest icons resolve.
- OG tags validate (correct absolute URLs, image dimensions).
- Icons readable at 16/24/192px (read the PNGs back).

## Out of scope

Custom domain in og:url (Railway domain for now), app-store assets.
