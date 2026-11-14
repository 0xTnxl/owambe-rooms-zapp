# Implementation Plan: Owambe Rooms v1

Depends on `zendfi/.kiro/specs/owambe-core` (Zend core) and `@zendfi/appkit` 0.6.0.

Gate:

- `pnpm typecheck && pnpm test && pnpm build` pass;
- the web bundle is ≤ 80 KB gzipped;
- copy is checked against the Zend user-facing language rules;
- a two-account round runs on staging.

## Setup

- [ ] 1. pnpm workspace, TypeScript configs, `zapp.json`, README, `.gitignore`.

## Engine

- [ ] 2. Types, config and money formatting (R3).
- [ ] 3. `createRound`, `act` (gift, bid, react), `tick` (phases, auctions, end) (R3.1-R3.6, R3.9).
- [ ] 4. Votes and `results` (R3.7, R3.8).
- [ ] 5. Bots (R2.1, R3.3).
- [ ] 6. Engine tests, including a full bot-only round.

## Server

- [ ] 7. Config, game tokens, the HTTP router and JSON helpers (R1.1).
- [ ] 8. Zend client: verify session, create and update interactions, blocked pairs, room socket,
  and webhook check.
- [ ] 9. Matchmaker: public queue, private rooms, rematch lobbies, avoid pairs (R2).
- [ ] 10. Round runner: tick loop, frames, presence, phase PATCHes, votes, leaving (R3, R7, R8).
- [ ] 11. Reports, avoid, events log, metrics script (R6, R9).
- [ ] 12. Server tests.

## Web

- [ ] 13. Shell: environment detection, Zend init, game session, router, styles (R1).
- [ ] 14. Home and Lobby, with invite share (R2, R5.1).
- [ ] 15. Round screen: seats, gift tray, auction, reactions, mute and report (R3, R6).
- [ ] 16. Vote and Results: friends, play again, share, post to feed (R3.7, R4, R5.2, R5.3).
- [ ] 17. Landing and Practice with bots, outside Zend (R1.2).
- [ ] 18. Chat-tray invite flow (R5.4).
- [ ] 19. Bundle size check.

## Launch (needs the owner)

- [ ] 20. Pick the origin and the server host. Register `owambe`, upload the manifest, add testers.
- [ ] 21. Staging round with two accounts, then the first playtest to set the PRD baselines.
