# Owambe Rooms

A live party game for strangers, built as a Zend ZApp. Everyone in a room of six starts with 50B
in play money and races to give it away: gifts to each other, and bids in quick auctions that burn
it. When the timer ends, the biggest bag loses. Then the room votes for the funniest person, and
players add the people they clicked with. Each add starts a Zend chat.

Spec: [`.kiro/specs/owambe-rooms/`](.kiro/specs/owambe-rooms/). The Zend core changes it relies
on are in `zendfi/.kiro/specs/owambe-core/`.

## Layout

| Path | What |
|---|---|
| `packages/engine` | Pure rules: rounds, gifts, the 5-in-a-row cap, auctions, ties, votes, results, bots. No I/O. |
| `server` | Node game server: Zend sign-in, matchmaking, round runner on Zend live rooms, reports, metrics. |
| `web` | The page: plain TypeScript and CSS, no framework, about 19 KB gzipped. Practice mode runs the engine locally. |
| `zapp.json` | Zend manifest (`post_card` and `connect` only: the game can't touch real money). |

## How a round runs

1. Lobbies are plain HTTP (`/api/play`, long-polled `/api/lobby`). A Zend room only exists once its
   interaction does.
2. At start, the server creates a `round` interaction for the people in the lobby, opens the Zend
   live room with its app key, and seats bots in the empty places.
3. Pages join with `zend.live.join`. They send intents only (`gift`, `bid`, `react`). The server
   checks every rule and answers as `from: "app"`, which is the only sender pages trust.
4. Votes go over HTTP, because everyone in a room sees every room message.
5. Phase moves (`voting`, `results`, `done`) are `serverOnly` in the manifest. At `done`, Zend
   closes the room.

## Develop

Requires Node 20.19+ and pnpm 10. `@zendfi/appkit` is linked from `../zend-appkit` until 0.6.0 is
published to npm. After that, change both `link:` entries to `^0.6.0`.

```sh
pnpm install
pnpm typecheck && pnpm test
pnpm dev:server   # OWAMBE_DEV=1: dev sign-in and a local stand-in for Zend's live rooms
pnpm dev:web      # http://localhost:5173, use two tabs with two names to play each other
pnpm build        # web/dist (fails above 80 KB gzipped) and server/dist/main.js
```

Dev mode copies the Zend rules that matter here: only participants can join a room, `from` is
stamped by the host, and rooms close on a terminal state. The server refuses to start without
real keys unless `OWAMBE_DEV=1`.

## Deploy

1. Build, then run `node server/dist/main.js` with the env in `.env.example`. Set
   `WEB_DIR=web/dist` so one origin serves both the page and the API. Run a single process: v1
   keeps live state in memory.
2. Register the app and upload the manifest for your origin:
   ```sh
   OWAMBE_ORIGIN=owambe.example.com pnpm -s manifest > manifest.json
   curl -X PUT $ZEND/api/zend/v2/apps/$APP_ID/manifest -H "Authorization: Bearer $TOKEN" -d @manifest.json
   ```
3. Share `https://app.usezend.app/apps/owambe`. Room links are `…/apps/owambe?room=CODE`.

## Metrics

`pnpm metrics [server/data/events.jsonl]` prints:

- second-round rate;
- friend adds per player per round;
- invite-link joins per room;
- reports;
- real active players: a round, a mutual friend, and at most two reporters.

Chat activity and retention come from Zend's data.
