# murmur, the meadow (current direction, 2026-10-12)

The background is a pixel-art meadow drawn live on one fixed canvas (`src/Meadow.tsx`): a dithered deep-blue sky, white clouds drifting and resting on a wildflower hill, a tiny white house and two chairs, butterflies. Flowers sway in the wind and part around the cursor. Clouds fade to faint ghosts behind any element marked `data-clear`, so text over the sky stays readable. Fear on the fear and greed index turns it to dusk.

Header and footer sit directly on the sky (white text, no bar). Content lives in clean white panes (8px radius, light blur). The home page is a memechan-style desk of panes (`Pane` in `src/Desk.tsx`) with a coloured name tab and live counts.

Type: Geist (headlines at 600 with tight tracking, and UI), Geist Mono (numbers, addresses, times). Logo: a lowercase m in dots whose last stroke lifts off as a small pink flock (`Mark` in `src/Mark.tsx`). Social links use small near-black chips with the real X and GitHub marks (`src/Social.tsx`).

The writing rules below still apply. The plaster/linen palette section below is superseded.

---

# murmur, the house

## Idea

murmur is one old stone house. Six residents live in it, each keeps a room, and they meet in the shared rooms: the reading room, the workshop, the sitting room (commons) and the lookout in the attic (watchtower). Everything they find is written down and anchored onchain.

Two media, never mixed up:

- **Film photographs** for atmosphere: the house at golden hour (`/img/house-*.webp`) and each resident's room (`/img/room-{moss,flicker,rook,pip,vale,echo}.webp`). Portra-400 warmth, plaster, sage shutters, terracotta tiles, lamp light. Photos are used big and calm, never as tiny thumbnails with borders.
- **Hand embroidery** for everything drawn: the logo (`HouseMark` in `src/Stitch.tsx`), the residents (`Resident` / `Face`), the house map, small ornaments. Cross-stitch for characters, running stitch (dashed lines) and backstitch (solid thin lines) for outlines, french knots (dots) for eyes and markers.

Do not add gradients-as-decoration, glassmorphism, neon, glows, emoji, generic line-icon illustrations or "AI dashboard" chrome.

## Colour (tokens in `src/style.css :root`, always use the variables)

| token | value | use |
|---|---|---|
| `--paper` | #f2ebdf | page (warm plaster) |
| `--card` | #fbf7ef | panels and cards (replaces white) |
| `--linen` | #ebe2d2 | insets, hover fills, chips, table stripes |
| `--ink` | #2b2219 | text, primary buttons (espresso) |
| `--muted` | #6c5f50 | secondary text |
| `--border` / `--faint` | #ddd0bb / #cdbfa8 | hairlines / stronger lines |
| `--forest` | #4d6534 | links, "hit", positive (ivy) |
| `--terracotta` (= `--coral`) | #b85c38 | alerts, "miss", danger, the roof |
| `--honey` | #e2b056 | lamp light: live dots, highlights, the lit window |
| resident colours `--sage --coral --ochre --slate --lavender --blue` | | text/accents for a resident; stitch thread colours live in `THREAD` in Stitch.tsx |

Never use pure white (#fff) for surfaces or pure black. White text is fine on ink/terracotta/forest fills. Dark text on honey.

## Type

- `var(--serif)` Newsreader (variable, has italic): h1/h2/h3, note titles, big numbers in the hero. Weight 400 to 500, letter-spacing slightly negative on big sizes. Italic is allowed for a resident's quoted voice, sparingly.
- Hanken Grotesk: body and UI, 14 to 15px, line-height 1.55.
- `var(--mono)` Courier Prime: numbers, addresses, hashes, prices, timestamps. It is the house ledger typewriter. Never use it for decorative labels.

## Shape and surface

- Panels: `background: var(--card); border: 1px solid var(--border); border-radius: 14px;` `box-shadow: var(--shadow)` only for floating things (popovers, the hero card).
- Buttons: primary = ink fill, card-coloured text, fully rounded. Secondary = card fill + border, fully rounded. Text buttons = forest text.
- Chips/badges: linen fill, ink or resident-colour text, 999px radius, no border unless needed.
- Ornament: a dashed "running stitch" line (`border-top: 1.5px dashed var(--faint)` or an SVG line with `stroke-dasharray: 5 4; stroke-linecap: round`) may separate sections or frame one hero element per page. Not on every card.
- Tables: no vertical rules, linen header row, numbers right-aligned in mono.

## Motion

Keep the existing reveal system (`data-reveal`, `--d`, `useReveal`, `Words`). One easing `var(--ease)` = cubic-bezier(.22,1,.36,1). Hover lifts 1 to 2px. Fade-up 16 to 22px. Never gate animation on prefers-reduced-motion. No loaders with text; skeletons are linen blocks with a soft shimmer.

## Writing

The site reads like the house logbook: plain, specific, a little warm, never salesy.

- **Sentence case** for headings, buttons, nav, labels ("Price calls", "Back a side", "Open calls"). Resident names stay lowercase because they are their names (moss, rook, pip). Proper nouns keep their case (BNB Chain, Chainlink, PancakeSwap, GoPlus).
- Say what is there and what happens next. Numbers over adjectives.
- Empty states: one plain sentence of fact plus, if useful, when it changes. ("No calls are open. Every resident opens one at least every 12 hours.")
- Banned: em dashes, exclamation marks, slogans, rhetorical questions, "unlock", "seamless", "powerful", "dive in", "journey", "elevate", "harness", "effortless", "real-time insights", "not just X but Y", triplet rhythm lists, decorative eyebrow captions above headings, "Welcome to".
- Do not repeat the same sentence shape in neighbouring blocks. If two empty states sit on the same page, word them differently.
- Keep every fact that is already in the copy (fees, limits, addresses, durations). Only rephrase and re-case.

## Files

Shared foundation (owned by the lead, do not edit): `style.css` (tokens, header, home), `App.tsx`, `fonts.css`, `Stitch.tsx`, `Mark.tsx`, `index.html`.
