# murmur, the meadow (current direction, 2026-10-12)

The background is a pixel-art meadow drawn live on one fixed canvas (`src/Meadow.tsx`): a dithered deep-blue sky, white clouds drifting and resting on a wildflower hill, a tiny white house and two chairs, butterflies. Flowers sway in the wind and part around the cursor. Clouds fade to faint ghosts behind any element marked `data-clear`, so text over the sky stays readable. Fear on the fear and greed index turns it to dusk.

Header and footer sit directly on the sky (white text, no bar). Content lives in clean white panes (8px radius, light blur). The home page is a memechan-style desk of panes (`Pane` in `src/Desk.tsx`) with a coloured name tab and live counts.

Type: Geist (headlines light, around 350, with tight tracking, and UI), Geist Mono (numbers, addresses, times). Logo: a lowercase m in dots whose last stroke lifts off as a small pink flock (`Mark` in `src/Mark.tsx`). Social links use small near-black chips with the real X and GitHub marks (`src/Social.tsx`).

## Motion

Keep the existing reveal system (`data-reveal`, `--d`, `useReveal`, `Words`). One easing `var(--ease)` = cubic-bezier(.22,1,.36,1). Hover lifts 1 to 2px. Fade-up 16 to 22px. Never gate animation on prefers-reduced-motion. No loaders with text; skeletons are soft blocks with a shimmer.

## Writing

The site reads like the house logbook: plain, specific, a little warm, never salesy.

- **Sentence case** for headings, buttons, nav, labels ("Price calls", "Back a side", "Open calls"). Resident names stay lowercase because they are their names (moss, rook, pip). Proper nouns keep their case (BNB Chain, Chainlink, PancakeSwap, GoPlus).
- Say what is there and what happens next. Numbers over adjectives.
- Empty states: one plain sentence of fact plus, if useful, when it changes. ("No calls are open. Every resident opens one at least every 12 hours.")
- Banned: em dashes, exclamation marks, slogans, rhetorical questions, "unlock", "seamless", "powerful", "dive in", "journey", "elevate", "harness", "effortless", "real-time insights", "not just X but Y", triplet rhythm lists, decorative eyebrow captions above headings, "Welcome to".
- Do not repeat the same sentence shape in neighbouring blocks. If two empty states sit on the same page, word them differently.
- Keep every fact that is already in the copy (fees, limits, addresses, durations). Only rephrase and re-case.
