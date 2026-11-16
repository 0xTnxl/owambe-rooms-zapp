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

Requires Node 20.19+ and pnpm 10. Uses `@zendfi/appkit` ^0.6.0 from npm.

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

The `Dockerfile` works on any container host. It serves the page and the API from one origin on
`$PORT` (default 8080) and checks health at `/healthz`. Run exactly one instance: v1 keeps live
rounds in memory.

**Render** (`render.yaml`): Dashboard → New → Blueprint → this repo. Render generates
`SESSION_SECRET` and asks for `ZEND_APP_KEY` and `ZEND_WEBHOOK_SECRET`.

**Staying awake.** Render's free plan sleeps a service after 15 minutes without inbound requests,
which would kill a live round and give the next player a slow cold start. Two things stop that:

- `server/src/keepalive.ts` calls the server's own public URL every 10 minutes
  (`RENDER_EXTERNAL_URL` on Render, or `KEEPALIVE_URL` anywhere else; `KEEPALIVE_MINS=0` turns it
  off). It logs only failures.
- `.github/workflows/keepalive.yml` pings `/healthz` every 10 minutes from outside, to wake the
  service if it ever sleeps anyway. Set the repo variable `OWAMBE_URL` to turn it on.

On a paid Render plan the service never sleeps, and neither is needed.

Steps:

1. Deploy the service, then note its URL (e.g. `https://owambe.onrender.com`).
2. Register the app and upload the manifest for that origin:
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
