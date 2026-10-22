# Election night board

A live results board for the Nov. 3, 2026 midterms: all 435 House seats, 35 Senate races
and 36 governor races on one screen, with a map, the balance of power for each chamber,
a calls log, and desk tools for entering calls yourself. Vote counts refresh from state
election offices about every 10 minutes.

It shows up in three places:

- **IntelHQ → Politics & Elections**, under "Live Results Board" (full desk tools)
- **Full screen** at `elections/index.html` (for a second monitor on election night)
- **Public version** at `elections/public.html`: read-only, for ocscanner.news (see below)

```
elections/
  board.js, board.css     the board (no libraries needed)
  index.html              full-screen IntelHQ page
  public.html             read-only page for the public site
  data/races-2026.json    every race: seat holder and named candidates
  data/us-states.json     state shapes for the map
  data/src/*.txt          the race lists the JSON is built from
  tools/build-data.mjs    rebuilds the two data files
  worker/                 the "oc-election-wire" Cloudflare Worker that collects results
```

## How updates work

The Worker runs on a timer every 5 minutes. Each run downloads whichever state files are due
(each state at most every 9 minutes) and saves the numbers per race. The board only ever reads
what's saved, refreshing every 60 seconds, so viewers never cause downloads from state servers.

States post test numbers in the weeks before an election. To keep those off the board, the Worker
downloads nothing and shows no state numbers before `RESULTS_START` (2 p.m. Pacific on Nov 3, an
hour before the first polls close).

State files carry vote counts only. **Race calls come from you** through the desk tools (or from AP,
if you license it). Seats only change color as "won" when you call them; until then they show who's leading.

## Where results come from

| Source | Covers | Cost |
|---|---|---|
| **State election offices** | 15 states, below | Free |
| **Your desk entries** | Any race: calls, and typed-in vote counts for states without a feed | Free |
| **AP Elections API** | Every race, votes and calls | Paid license (elections_api_info@ap.org). Turns on when you add `AP_API_KEY` |

When two sources cover a race, numbers come from AP first, then the state, then what you typed in.

| State | What was found when the real files were checked (Oct 21) |
|---|---|
| FL, NC, MN, NE, SD | **Nov 3 files already posted** and match the board. Minnesota's and California's currently hold practice numbers |
| CA | Live and serving practice numbers (Hilton "leading" at 100% reporting); held off the board until Nov 3 |
| AZ, VA | Nov 3 election listed on the Enhanced Voting system; race data matches the board |
| GA | Same system; Nov 3 not listed yet. The board looks it up every run until it appears |
| CO, IA | Nov 3 not listed yet; their 2024 and 2026 primary files match the board |
| WA | Nov 3 export not posted yet; the 2024 file matches the board |
| UT, ID | Not opened yet (Chrome blocked the sites). Same system as AZ and GA; check with the preview tool |
| TX | **Not found.** Texas's results system has nothing after 2024, and its 2026 primaries weren't posted there. Shows "not posted" until Texas publishes; enter key Texas races at the desk |

Check again with the preview tool on Nov 2 or the morning of Nov 3.

States with no free statewide feed (Wisconsin, Massachusetts, Illinois, New Jersey, Wyoming,
Mississippi and others) fill in only from your desk entries or AP. The full state-by-state
research is in the "Free election results feeds, state by state" doc.

## Free plan or Workers Paid

Cloudflare's free plan allows 100,000 requests a day **per account** (shared with the radar proxy),
50 downloads per run and 10 ms of computing time per run.

- **Free:** the Worker spreads downloads across runs (`SUBREQUEST_BUDGET = "45"`), so every state
  still refreshes within about 15 minutes. But big files (North Carolina, Texas, Florida, Georgia)
  may take more than 10 ms to read, and those states will show "failing".
- **Workers Paid ($5/month):** 30 seconds per run and 10 million requests a month, covering both Workers.
  Set `SUBREQUEST_BUDGET = "500"` in `wrangler.toml` and redeploy so every state refreshes every run.
  Recommended for November, especially if the public page gets shared; cancel afterward.

## One-time setup (about 15 minutes)

You need Node.js installed. In a terminal:

```bash
cd elections/worker
npm install
npx wrangler login                                  # opens Cloudflare in your browser
# The database (oc-election-wire) and its tables already exist; its id is in wrangler.toml.
# On a new Cloudflare account: npx wrangler d1 create oc-election-wire, put the id in wrangler.toml, then npm run db:init
npx wrangler secret put DESK_TOKEN                  # make up a long password; this unlocks desk mode
npm run deploy
```

Deploy prints the Worker's address. If it isn't
`https://oc-election-wire.ocscannernews.workers.dev`, change `DEFAULT_API` at the top of
`elections/board.js` to match.

Then commit and push the IntelHQ repo as usual so `elections/` and the updated `hq.html` go live.

**Already set up the earlier version?** Run `npm run db:init` again (it only adds the new tables), then `npm run deploy`.

**If you license AP:** `npx wrangler secret put AP_API_KEY`, then `npm run deploy`.

## Checking a state's feed (preview tool)

It needs your desk token, so run it from Terminal (change `GA` to any feed state):

```bash
curl -H "Authorization: Bearer YOUR_DESK_TOKEN" "https://oc-election-wire.ocscannernews.workers.dev/v1/desk/preview?state=GA"
```

It downloads that state right now (even before Nov 3), and shows which races it found and the
top candidates, without saving anything. "not posted" means the state hasn't put up its Nov 3 file
yet. Numbers you see before election night are the state's test data.

## Before election night

1. Open the board and turn on **Rehearsal data**. It plays a fake election night on a
   90-minute loop so you can practice. Everything in rehearsal is labeled, copied posts start
   with "[REHEARSAL, NOT REAL RESULTS]", and rehearsal desk calls are stored separately from real ones.
2. Click **Desk sign-in** and enter your `DESK_TOKEN`. Practice a call and a withdrawal.
3. Star the races you care about. **Chime on watched calls** plays a tone when one is called.
4. Turn rehearsal off. The board should say "No results yet" and "State feeds start Nov 3, 2:00 PM".
5. Run the preview tool for each state on Nov 2 or the morning of Nov 3.

## On election night

- **State feeds** (top left of the board) shows each state: how many races it filled, when it was
  last checked, and any errors. Yellow means some of a state's files failed.
- **Make a call:** select the race, choose who made the call (you, AP, Decision Desk HQ, NBC…),
  press **Call for …**, then **Publish call**. It shows on the board within about a minute.
- **Withdraw a call:** select the race, **Withdraw call**. **Undo withdrawal** removes your override.
- **Type in numbers** for a race no feed covers: **Enter vote counts**.
- **Copy post for X** writes a ready-to-post line for the selected race.
- **Close** shows uncalled races within 5 points. **Flips** shows seats that changed hands
  or where the other party leads.

## Putting it on the public site (ocscanner.news)

`public.html` is the same board with no desk sign-in, rehearsal switch or Copy post for X. Your calls
appear on it once you make them in IntelHQ. To publish it:

1. Copy `board.js`, `board.css`, `public.html` and `data/us-states.json` into the public site repo,
   for example as `elections/index.html` (rename `public.html`), `elections/board.js`, and so on.
2. If the public site runs somewhere other than ocscanner.github.io or ocscanner.news, add that
   address to `ALLOWED_ORIGINS` in `wrangler.toml`.
3. Turn on Workers Paid first if you'll promote the link (see above).

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

## Settings (`worker/wrangler.toml`)

| Setting | Default | What it does |
|---|---|---|
| `RESULTS_START` | `2026-11-03T22:00:00Z` | No state downloads or state numbers before this time |
| `STATE_FEEDS` | `all` | Which states to download, e.g. `"GA,NC,TX"`, or `"off"` |
| `MIN_REFRESH_MINUTES` | `9` | How often each state is downloaded, at most |
| `SUBREQUEST_BUDGET` | `45` | Downloads per 5-minute run; `500` on Workers Paid |
| `SIMULATE` | `false` | Serve rehearsal data by default |

## Worker endpoints

| Path | What it returns |
|---|---|
| `GET /v1/board` | Every race and the seat summaries. Add `?sim=1` for rehearsal data |
| `GET /v1/feed` | Latest calls and withdrawals |
| `GET /v1/health` | Switches, state feed list, when feeds start |
| `GET /v1/desk/preview?state=XX` | Download and parse one state now, without saving (desk token) |
| `POST /v1/desk/call` · `retract` · `clear` · `result` | Desk actions (desk token) |

Run the tests with `npm test` in `elections/worker`.
