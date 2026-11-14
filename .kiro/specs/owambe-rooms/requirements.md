# Requirements Document: Owambe Rooms (v1, phase 2 of the PRD)

## Introduction

Owambe Rooms is a live party game. About six people share a short room. Everyone starts with the
same pile of play money and races to give it away: gifts to each other, and bids in quick auctions
that burn money. When the timer ends, whoever holds the most loses. Then the room votes for the
funniest person, sees the results, and adds the people they clicked with as friends.

It is built as a **ZApp** on Zend. Zend provides sign-in ("Continue with Google"), identity, the
live room transport, cards in chats and the feed, the share sheet, and friends and chat after the
round. Every player is a Zend user, and every friend they add lands in Zend chat. That is how the
game pulls people into Zend.

Source: PRD "Owambe Rooms" (14 Nov 2026, @Blessed). This spec covers PRD phase 2 (multiplayer
rooms) and the share, link and chat-invite loops from phase 3. It does not cover rewards, rotating
modes, real money or an open network.

Zend core changes this depends on: `zendfi/.kiro/specs/owambe-core/` (`people.connect`,
`people.chat`, `share`, launch params on app links, blocked pairs).

## Glossary

- **Play money:** the in-game currency. It is always called "play money" and has no value outside
  a round.
- **Bag:** a player's play-money balance in the current round.
- **Round:** one live game of about six seats, from "Get ready" to results.
- **Seat:** a human player or a bot.
- **Room code:** six characters that name a private room, e.g. `KQ7M2D`.
- **Game server:** Owambe's own Node service. It is the only source of truth for every rule.
- **Zend room:** the Zend live room for the round's interaction.

## Decisions on the PRD's open questions

The defaults below are in `server/src/config.ts` and are to be retuned in playtests.

| Question | v1 answer |
|---|---|
| Round length | 120 s of play (`ROUND_SECS`), then a 20 s vote and 45 s of results |
| Start, prices, cap | ₦50B start, PRD items and prices, 5-in-a-row cap |
| Ties for biggest bag | Of the tied players, whoever received play money most recently loses |
| Label bots | Yes, a small "bot" tag (`LABEL_BOTS`) |
| Languages | English, with Nigerian party flavour in the copy. Pidgin later |
| Room chat | Preset reactions and lines only, no free text in v1 (safety, no moderation queue for text) |
| Load budget | Game page ≤ 80 KB gzipped (JS + CSS). A round uses ≤ 400 KB of data per player |

## Requirements

### R1 Sign in and start

1. Inside Zend, the page SHALL read the player from `zend.identity.get()` and exchange its
   `appSession` with the game server for a game session (12 h). It SHALL ask nothing else.
2. In a plain browser, the page SHALL show a landing with **Play now**, which opens
   `https://app.usezend.app/apps/owambe` with the same `room` param, and **Practice with bots**,
   which needs no account.
3. A room link `…/apps/owambe?room=CODE` SHALL take a signed-in player straight to that room's lobby.

### R2 Matchmaking

1. **Play now** SHALL put the player in a public queue. A round starts as soon as 6 people wait, or
   8 s after the longest-waiting person joined. Bots fill the empty seats. Nobody waits in an empty
   room.
2. **Start a room** SHALL make a private room with a code and a link. The host sees who joined and
   taps **Start**, and bots fill up to 6. Up to 6 humans per room.
3. **Play again** on the results screen SHALL put the player in a rematch lobby with the humans from
   that round who also tap it. It starts 12 s after the first tap, or at once when all of them are
   in, with bots filling the rest.
4. The server SHALL NOT seat together two people where either one blocked the other in Zend
   (`blockedPairs`) or in Owambe ("Don't match me with them").
5. A player is in at most one queue or round at a time. A new **Play** replaces the old ticket.

### R3 The round

1. Every seat starts with ₦50B of play money.
2. **Gift:** pick a person, pick an item. The giver's bag drops by the price and the receiver's
   rises by the same. A gift needs a bag of at least the price. Items:
   - jollof ₦2M
   - gold chain ₦500M
   - danfo ₦1B
   - Lekki duplex ₦8B
   - private jet ₦20B
3. **Same-person cap:** at most 5 gifts in a row to the same person. Gifting someone else resets
   it. Bots follow the cap.
4. **Auctions:** two per round, at 35% and 70% of the play time, each lasting 10 s. Bids go up in
   steps and can't exceed the bidder's bag. The highest bid when time runs out is paid and leaves
   the game.
5. A live indicator SHALL always show who holds the biggest bag.
6. **End:** when play time ends, the biggest bag loses (ties per the decisions table). Leftover play
   money disappears.
7. **Vote:** each human votes for the funniest other person (20 s). Votes are private until results.
8. **Results:** the loser, the most generous person (most given in gifts) and the funniest (most
   votes; ties share it).
9. **Leaving:** a player can leave at any time. A player who left or dropped for more than 10 s is
   "away": nobody can gift to them, their bag is frozen, and they can still lose. They rejoin the
   round if they come back.
10. **Reactions:** a fixed set of emoji and lines (e.g. "Na wa o", "Who send you?", "Abeg collect")
    that float over the sender. At most 1 a second per person.

### R4 After the round: friends

1. Results SHALL show every other human with **Add friend**, which calls `zend.people.connect`
   with a note naming the room and one thing that happened between them.
2. When someone adds the player, the player SHALL see "{name} added you" with **Add back** on the
   results screen.
3. Once added, the button turns into **Chat**, which calls `zend.people.chat`.
4. Bots have no friend buttons.

### R5 Growth loops

1. **Invite** in a lobby SHALL call `zend.share` with a room link.
2. **Share** on results SHALL call `zend.share` with the loser line and a link.
3. **Post to feed** on results, shown only when the round had at least two humans, SHALL post a
   `result` card. Its text says "play money" and never shows ₦.
4. **Chat tray:** "Play Owambe" in a Zend chat SHALL make a private room and post an `invite` card
   into that chat, with a **Join** button that opens the room.
5. Joins through a room link SHALL be recorded with the room's host, for future rewards.

### R6 Safety

1. **Report** on any player in a round or on results SHALL record the report (reason, round, both
   ids) for review. It also stops matching the two together.
2. **Mute** SHALL hide a player's reactions for the rest of the round on that device.
3. **Don't match me with them** on results SHALL stop matching the two together.
4. Player actions over 8 per second SHALL be dropped by the server.
5. Names and avatars come from Zend. Owambe stores no other personal data.

### R7 Fairness and trust

1. The server SHALL validate every action against the rules. Clients only send intents.
2. Clients SHALL trust Zend room messages only when `from` is `"app"` (the game server).
3. Round state moves (`voting`, `results`, `done`) are `serverOnly` in the manifest. So is
   `expired`, so a player can't close the room for everyone.

### R8 Performance

1. The page is plain DOM and CSS with no framework: ≤ 80 KB gzipped, and works on a 2 GB Android
   phone in Chrome.
2. The server sends changes at most 5 times a second, and a full snapshot on join and every 5 s.

### R9 Metrics

The server SHALL log events (JSON lines) for every metric in the PRD:

- round started and finished;
- second round in the same session;
- friend adds, one-way and mutual (from the `people.connected` webhook);
- invite-link joins;
- reports.

`npm run metrics` SHALL print:

- second-round rate;
- friend adds per player per round;
- invite joins per room;
- real active players: at least one round and one mutual friend, not reported more than twice.

Chat activity and retention come from Zend's own data later.

## Out of scope (v1)

- Rewards and the weekly pool.
- Rotating modes.
- Loser video clips.
- Free-text room chat.
- Real money of any kind.
- The game never asks for money permissions: its manifest has only `post_card` and `connect`.
