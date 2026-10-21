# Election night board

A live results board for the Nov. 3, 2026 midterms: all 435 House seats, 35 Senate races
and 36 governor races on one screen, with a map, the balance of power for each chamber,
a calls log, and desk tools for entering calls yourself.

It shows up in two places:

- **IntelHQ → Politics & Elections**, under "Live Results Board"
- **Full screen** at `elections/index.html` (for a second monitor on election night)

```
elections/
  board.js, board.css     the board (no libraries needed)
  index.html              full-screen page
  data/races-2026.json    every race: seat holder and named candidates
  data/us-states.json     state shapes for the map
  data/src/*.txt          the race lists the JSON is built from
  tools/build-data.mjs    rebuilds the two data files
  worker/                 the "oc-election-wire" Cloudflare Worker that serves results
```

## Where results come from

| Source | Covers | Cost | Status |
|---|---|---|---|
| **Desk calls** (you) | Any race | Free | Ready. Relay calls from AP, DDHQ, NBC, etc. with the source credited |
| **California Secretary of State** | CA governor + the House districts listed in `CA_SOS_DISTRICTS` | Free | Ready |
| **AP Elections API** | Every race nationwide, votes and calls, updated automatically | Paid license from AP | Code ready, turns on when you add `AP_API_KEY` |
| **Decision Desk HQ API** | Same idea as AP | Contact DDHQ sales | Not built yet |

There is no free feed that covers every state. Without AP (or DDHQ), the board fills
in automatically for California and relies on desk calls everywhere else. The AP adapter
follows AP's published field layout but hasn't been run against a live AP key; test it with
`AP_TEST = "true"` before election night if you license it.

When two sources cover the same race, vote counts come from AP first, then California SOS,
then numbers you typed in. A desk call (or a withdrawn call) always wins over a feed call.

## One-time setup (about 15 minutes)

You need Node.js installed. In a terminal:

```bash
cd elections/worker
npm install
npx wrangler login                                  # opens Cloudflare in your browser
npx wrangler d1 create oc-election-wire             # copy the database_id it prints…
#   …and paste it into wrangler.toml where it says REPLACE_WITH_ID_FROM_wrangler_d1_create
npm run db:init                                     # creates the tables
npx wrangler secret put DESK_TOKEN                  # make up a long password; this unlocks desk mode
npm run deploy
```

Deploy prints the Worker's address. If it isn't
`https://oc-election-wire.ocscannernews.workers.dev`, change `DEFAULT_API` at the top of
`elections/board.js` to match.

Then commit and push the IntelHQ repo as usual so `elections/` and the updated `hq.html` go live.

**If you license AP:** `npx wrangler secret put AP_API_KEY`, then `npm run deploy`.

## Before election night

1. Open the board and turn on **Rehearsal data**. It plays a fake election night on a
   90-minute loop so you can practice. Everything in rehearsal is labeled, copied posts start
   with "[REHEARSAL, NOT REAL RESULTS]", and rehearsal desk calls are stored separately from real ones.
2. Click **Desk sign-in** and enter your `DESK_TOKEN`. Practice a call and a withdrawal.
3. Star the races you care about. **Chime on watched calls** plays a tone when one is called.
4. Turn rehearsal off. The board should say "No results yet" until counting starts.

## On election night

- **Make a call:** select the race, choose who made the call (AP, Decision Desk HQ, NBC…),
  press **Call for …**, then **Publish call**. It shows on the board within about 20 seconds.
- **Withdraw a call:** select the race, **Withdraw call**. This also hides a feed's call
  if you think it's premature. **Undo withdrawal** hands control back to the feed.
- **Type in numbers** for a race no feed covers: **Enter vote counts**.
- **Copy post for X** writes a ready-to-post line for the selected race.
- **Close** shows uncalled races within 5 points. **Flips** shows seats that changed hands
  or where the other party leads.

## Updating the race list

Candidates and seat holders are in `data/src/house.txt`, `senate.txt` and `governor.txt`
(`Race|Candidates|Held by`). They were compiled from public race listings in October 2026;
check any race that matters to you. After editing:

```bash
cd elections/tools && npm install && node build-data.mjs
```

It checks that every state has the right number of House seats. Then redeploy the Worker
(`npm run deploy` in `elections/worker`) and push the repo.

Seats not on the ballot (the 65 Senate seats and 14 governorships) are set near the bottom of
`build-data.mjs`.

## Worker endpoints

| Path | What it returns |
|---|---|
| `GET /v1/board` | Every race and the seat summaries. Add `?sim=1` for rehearsal data |
| `GET /v1/feed` | Latest calls and withdrawals |
| `GET /v1/health` | Which sources are switched on |
| `POST /v1/desk/call` · `retract` · `clear` · `result` | Desk actions (needs the desk token) |

Run the tests with `npm test` in `elections/worker`.
