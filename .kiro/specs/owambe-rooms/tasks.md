# Implementation Plan: Owambe Rooms v1

Depends on `zendfi/.kiro/specs/owambe-core` (Zend core) and `@zendfi/appkit` 0.6.0. That version
is linked from `../zend-appkit` until it's published.

Gate:

- `pnpm typecheck && pnpm test && pnpm build` pass;
- the web bundle is ≤ 80 KB gzipped (18.7 KB now);
- copy is checked against the Zend user-facing language rules;
- a two-account round runs on staging.

## Setup

- [x] 1. pnpm workspace, TypeScript configs, `zapp.json` and `scripts/manifest.mjs`, README,
  `.env.example`, `.gitignore`.

## Engine

- [x] 2. Types, config and money formatting (play money shown without ₦) (R3).
- [x] 3. `createRound`, `act`, `tick`; the top bid is held back from gifts (R3.1-R3.6, R3.9).
- [x] 4. Votes and `results`; bots vote too (R3.7, R3.8).
- [x] 5. Bots: eager, sneaky and chaotic, with the same cap (R2.1, R3.3).
- [x] 6. Engine tests (18), including five seeded bot-only rounds checked against the invariants.

## Server

- [x] 7. Config (fails closed), game tokens, router, rate limits (R1.1).
- [x] 8. Zend port: `RealZend` (verify, interactions, blocked pairs, live room socket) and
  `DevZend` for local play.
- [x] 9. Matchmaker: public queue, private rooms, rematch, avoid pairs and Zend blocks (R2).
- [x] 10. Round runner (R3, R7, R8):
  - frames under Zend's 20/s and 8 KB limits;
  - presence;
  - phase moves on the interaction;
  - votes, leaving, friend-add relay.
- [x] 11. Reports, avoid, events log, `pnpm metrics` (R6, R9).
- [x] 12. Server tests (15).
- [x] 12a. End-to-end check against the dev server: two players, a private room by link, a
  stranger refused, gifts, an error, a reaction, votes, early results, the friend-add hint,
  conservation, the room closing, and a rematch.

## Web

- [x] 13. Shell: environment, Zend sign-in, session, resume after refresh, styles (R1).
- [x] 14. Home and Lobby, with invite share (R2, R5.1).
- [x] 15. Round screen: seats, gift tray, auction, reactions, mute and report (R3, R6).
- [x] 16. Vote and Results: friends (add, add back, chat), play again, share, post to feed (R3.7,
  R4, R5.2, R5.3).
- [x] 17. Landing and Practice with bots outside Zend, plus dev sign-in (R1.2).
- [x] 18. Chat-tray invite: room and invite card; the card turns "joined" (R5.4).
- [x] 19. Bundle size check in `pnpm build`.

## Launch (needs the owner)

- [ ] 20. Deploy the Zend core changes (`owambe-core` tasks 14-17) and publish `@zendfi/appkit@0.6.0`.
- [ ] 21. Pick the origin and the server host. Register `owambe`, upload the manifest, add testers.
- [ ] 22. Staging round with two accounts in the real Zend app and on web. This is the first test
  of `zend.live`, `people.connect` and the chat-tray flow against real Zend.
- [ ] 23. First playtest to set the PRD baselines (second-round rate, friend adds per round).
