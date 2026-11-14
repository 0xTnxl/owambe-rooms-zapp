# Design: Owambe Rooms

## Layout

```
owambe/
  zapp.json                 Zend manifest
  packages/engine/          Pure rules: round state, gifts, cap, auctions, results, bots. No I/O.
  server/                   Node 20 game server: sessions, matchmaking, rounds, Zend I/O, metrics
  web/                      Vite + TypeScript page: DOM + CSS, no framework
```

This is a pnpm workspace. The engine is shared: the server runs real rounds with it, and the web
page runs **Practice with bots** with it locally.

## Architecture

```
 phone (Zend app / app.usezend.app)          game server                         Zend API
 ┌─────────────────────────────┐   HTTPS   ┌──────────────────────┐  app key   ┌───────────────┐
 │ Owambe page ── @zendfi/appkit├─────────▶│ /api/session          │──────────▶│ token/verify  │
 │   identity, live, people,   │  (lobby,  │ /api/play, /lobby     │──────────▶│ server/       │
 │   share, postCard           │   votes)  │ /api/vote, /report    │           │  interactions │
 │        ▲ live room          │           │ round engine + bots   │──────────▶│ server/people/│
 └────────┼────────────────────┘           │                       │           │  blocked      │
          │ Zend room (wss, via Zend)      │   ws (app key) ───────┼──────────▶│ server/live/… │
          └────────────────────────────────┴───────────────────────┘◀──────────┤ webhooks      │
                                                                                └───────────────┘
```

- **Lobby over HTTP.** A Zend room exists only once its interaction does, and interaction
  participants are fixed at creation. So queues and lobbies live on the game server, and the page
  long-polls `GET /api/lobby` (25 s, versioned).
- **Round over the Zend room.** When a lobby starts:
  1. the server creates a `round` interaction (`created_by` = the first human, participants = the
     other humans' app user ids, `expires_in_secs: 1800`);
  2. it opens `wss://api.usezend.app/api/zend/v2/apps/server/live/<id>/ws` with the app key;
  3. the lobby answers with `interactionId`;
  4. pages call `zend.live.join(id)`.
- **Votes over HTTP.** Every room message reaches every member, so a vote sent in the room would be
  visible to the other pages. Votes go to `POST /api/vote` instead.

### Why Zend rooms are enough

The numbers come from `zendfi/src/app_live.rs`.

| Limit | Value | Our use |
|---|---|---|
| Frame | 8 KB | Snapshot ≈ 1.2 KB (6 seats), change frame ≈ 150–400 B |
| Per connection | 20/s | Server sends ≤ 5/s, plus targeted errors (capped at 10/s total) |
| Per room | 200/s | 6 humans × 8 actions/s (our cap) + 5 = 53/s |
| Membership | interaction participants | Fixed at round start; bots are server-side |
| Fan-out | Redis bus across API tasks | Server and players can be on different tasks |
| History | none | Snapshot on presence change and every 5 s |

A player's room messages (gift and bid intents, reactions) are seen by the other pages too. That
is fine: they're public actions. Pages ignore everything not from `"app"`.

## Engine (`packages/engine`)

```ts
type Phase = "ready" | "playing" | "voting" | "results";
createRound(cfg, seats, now): Round
act(round, seatId, action, now): { ok: true; events } | { ok: false; code }
  // action: { t: "gift", to, item } | { t: "bid", amount } | { t: "react", r }
tick(round, now): events[]            // phase changes, auction open/close, end of play
vote(round, voterId, forId): ok | code
results(round): { loserId, generousId, funniestIds, standings }
botAct(round, botId, rng, now): action | null
```

- **Money.** Amounts are integers in ₦ (≤ 3·10¹¹, safe in a JS number).
- **State per seat:**
  - `bag`, `given`, `received`, `lastReceivedAt` (used for the tie rule);
  - `streak` = `{ to, n }` (the cap);
  - `away`, `bot`.
- **Auctions.** They are scheduled at `start + p·ROUND`, for p = 0.35 and 0.70. Each has a lot (a
  random item name, for fun only). The minimum bid is ₦1B. Each bid must beat the high bid by at
  least ₦500M and fit the bidder's bag. At the close, the winner pays and the money is burned.
- **Bots.** They are seeded per round (mulberry32) and have three temperaments:
  - eager: dumps the biggest item on the leader;
  - sneaky: spreads gifts and bids late;
  - chaotic: random.

  Each bot thinks every 600–1400 ms, follows the same rules and cap, and bids when its bag is near
  the top.
- **Determinism.** Time and randomness are injected, so tests run whole rounds with no timers.

## Server (`server/`)

| Path | Auth | Purpose |
|---|---|---|
| `POST /api/session` | – | `{ appSession }` → `verifySession` → signed game token + player |
| `POST /api/play` | game | `{ mode: "public" \| "room" \| "again", code?, round? }` → ticket |
| `POST /api/rooms` | game | New private room `{ code, link }`, joined as host |
| `POST /api/rooms/:code/start` | host | Start now, bots fill |
| `GET /api/lobby?ticket&v` | game | Long-poll lobby: members, status, `interactionId` when started |
| `POST /api/leave` | game | Leave queue, lobby or round |
| `POST /api/vote` | game | `{ round, for }` |
| `POST /api/report` | game | `{ round, target, reason }` |
| `POST /api/avoid` | game | `{ target }` |
| `GET /api/round/:id` | game | Snapshot, for reconnects |
| `POST /zend/webhook` | HMAC | `people.connected` → metrics |
| `GET /healthz` | – | |

- **Game token.** `base64url(json).base64url(hmac-sha256)`, holding `{ sub: appUserId, name,
  avatar, iat, exp }`. Keyed by `SESSION_SECRET` (≥ 32 bytes). No server-side session store.
- **Matchmaker.** A 1 s loop.
  - Public queue: take waiting players oldest first. Greedily add each one who has no avoid pair
    with anyone already picked, up to 6. Start when there are 6, or when the oldest has waited 8 s.
  - Avoid pairs are the local `avoid` set plus `blockedPairs` from Zend. They are fetched for the
    candidate group, with a 30 s cache.
- **Round runner.** Each live round has a `setInterval(100 ms)`: `tick` → bots → flush. Flushes
  coalesce events to at most one frame every 200 ms. A full snapshot goes out every 5 s and on every
  presence event.
  - **Phases:** `ready` (5 s, waiting for presence) → `playing` → `voting` → `results` → done.
  - **Zend state:** the server PATCHes the interaction (`voting`, `results`, `done`) with idempotency
    keys `<id>:<state>`.
- **Room I/O** uses the `ws` package (an `Authorization` header is needed). It reconnects with
  backoff while the round is live.
- **Inbound frames:** `{ type: "live_message", from, data }`, where `from` is an app user id. These
  are mapped to seats. Unknown senders and frames over the per-seat 8/s budget are dropped.
  `live_presence` updates `away`. The exact frame names are those in `pool_ws.rs`
  `WsServerFrame` (snake_case).
- **Storage (v1):** in memory for live state. `data/events.jsonl` (append) holds metrics and reports;
  `data/avoid.json` holds avoid pairs. One process. Postgres comes when we run more than one.
- **Config:** env with defaults. It includes `ZEND_APP_KEY`, `ZEND_WEBHOOK_SECRET`, `ZEND_API`,
  `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ROUND_SECS` and the others in `config.ts`.

### Room protocol (`data` of room messages)

```ts
// server → pages (from "app")
{ t: "snap", v, now, round: PublicRound }        // full state
{ t: "ev", v, now, ev: Event[], bags: Record<seat, number>, lead: seat }
{ t: "err", to: seat, code }                     // CAP_REACHED, NOT_ENOUGH, AWAY, TOO_LOW, …
{ t: "added", from: seat, to: seat }             // friend-add hint (relayed)
// page → server
{ t: "gift", to, item, n } | { t: "bid", amount, n } | { t: "react", r, n } | { t: "added", to }
```

## Web (`web/`)

- **Screens:** Home → Lobby → Round → Vote → Results; Landing (outside Zend); Practice (local
  engine). A tiny `h()` DOM helper with no virtual DOM, so each screen re-renders its own root.
- **Round layout:**
  - top bar: timer and "Biggest bag: {name}" (pulses when it's you);
  - seat grid of 6, each with avatar, name, bag and a 🔥 streak dot;
  - tapping a seat opens the item tray: 5 items with prices, greyed when you can't afford one or
    are capped;
  - auction banner with **Bid +₦500M**, **+₦5B** and **Max**;
  - reactions row.
- **Copy and amounts:** amounts read ₦2M, ₦1.5B. The HUD always carries a "play money" label.
  Anything leaving the game (cards, share text, chat notes) says "50B in play money" with no ₦.
  User-facing copy follows the Zend rules: no crypto words.
- **Zend calls:**
  - `identity.get`, `live.join` and `live.leave`;
  - `people.connect`, `people.chat`, `share`, `postCard`;
  - `interaction.create` and `postCard` for chat-tray invites.

  `NOT_IN_ZEND` switches to Landing. `UNKNOWN_METHOD` (an older Zend) hides that button.
- **Budget:** about 25 KB of JS for engine and UI, plus 8 KB of CSS. System font, emoji for item
  art, no images.

## Manifest (`zapp.json`)

- `permissions: ["post_card", "connect"]`, `cardTypes: ["result", "invite"]`.
- `chatActions`: `play`, label "Play Owambe", interaction `invite`.
- `round` is `playing → voting → results → done`, every move `serverOnly`, including `expired`.
- `invite` is `sent → joined | expired`.
- `origins` and `webhook` are set per deploy (`OWAMBE_ORIGIN`).

## Testing

- **Engine (vitest):**
  - gifts move money exactly and the total is conserved minus burns;
  - the cap blocks the 6th gift in a row and resets;
  - an auction burns the winning bid, a bid above the bag is refused, the minimum increment holds;
  - the tie rule;
  - away seats can't receive;
  - results: most generous, funniest ties, no self-votes;
  - a full simulated round with 6 bots never breaks an invariant (bags ≥ 0, no step above the cap).
- **Server (vitest):**
  - the token round trip and expiry;
  - the matchmaker: fill after 8 s, avoid pairs respected, one ticket per player;
  - webhook signature;
  - the frame budget.
- **Web:** `vite build` plus a size check script (fails above 80 KB gzipped).
