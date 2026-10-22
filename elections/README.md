# Election night board

A live results board for the Nov. 3, 2026 midterms: all 435 House seats, 35 Senate races
and 36 governor races on one screen, with a map, the balance of power for each chamber,
a calls log, and desk tools for entering calls yourself. Vote counts refresh from state
election offices about every 10 minutes.

It also has:

- **Zoom into a state.** Select a state and the US map zooms into it and draws its counties. On the
  Senate and Governors tabs the counties are colored by who's ahead (stronger color = wider lead); on the
  House tab the state's races are listed below. Switching tabs keeps you on the same state; select a
  neighboring state to jump there; "← US map" (or Esc) zooms back out. On phones, tap a county for its numbers.
- **An Orange County tab** with every local race on the Nov 3 ballot: 2 county supervisor races,
  77 city races in 31 cities, 47 school and college board races, 12 water and special districts,
  14 state legislative races (OC votes only), and local measures once the Registrar posts them.

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
  data/counties/XX.json   county shapes, one small file per state (loaded when you open a state)
  data/oc-local-2026.json Orange County local contests and candidates
  data/src/oc-local.txt   the OC list it's built from (Registrar's candidate list, Aug 28)
  data/src/*.txt          the race lists the JSON is built from
  tools/build-data.mjs    rebuilds the race list and state shapes
  tools/build-counties.mjs  rebuilds the county shapes and county-name lookup
  tools/build-local.mjs   rebuilds the Orange County list
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
| **State election offices** | 17 states, below | Free |
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
| PA | Nov 3 feed already posted in test mode (governor, all 17 House seats, by county) |
| OH | Nov 3 contest API already serving practice numbers (governor, Senate special, all 15 House seats) |
| TX | **Not found.** Texas's results system has nothing after 2024, and its 2026 primaries weren't posted there. Shows "not posted" until Texas publishes; enter key Texas races at the desk |

Check again with the preview tool on Nov 2 or the morning of Nov 3.

States with no free statewide feed (Wisconsin, Massachusetts, Illinois, New Jersey, Wyoming,
Mississippi and others) fill in only from your desk entries or AP. The full state-by-state
research is in the "Free election results feeds, state by state" doc.

## County maps

County counts come from the same state offices, from their county-by-county files:

| State | County file |
|---|---|
| CA | Secretary of State "maps" file (one download, every county) |
| FL | Same statewide file, which is already by county |
| NC | `precinct_0.txt`: every statewide contest by county |
| MN | `allracesbycounty.txt` |
| CO, IA | Clarity `detailxml.zip` |
| PA | The Department of State's "Results by Office" election feed (every race by county, one download) |
| GA, VA, AZ, ID, UT | Enhanced Voting "results by county" for each Senate or governor race |

Texas, Nebraska, South Dakota and Ohio don't publish a free county file (Ohio's statewide numbers are
on the board), Nevada's results site blocks automated downloads, Michigan posts no election-night file,
and states with no feed at all have none either. Their county maps say so (AP would fill them in if you license it).

**County downloads are off until you switch on Workers Paid.** The county files are large (Georgia's
is about 2.5 MB per race), more than the free plan's 10 ms of computing time per run can read. When
you upgrade, set `COUNTY_FEEDS = "on"` along with `SUBREQUEST_BUDGET = "500"` in `wrangler.toml`.
Rehearsal data shows practice county maps for every state either way.

## Orange County tab

Results come from the OC Registrar of Voters' own results file (Live Voter Turnout, the system behind
ocvote.gov's results page). The Worker checks it on the same 10-minute timer as the states. The file is
numbered by election (#18 was Nov 2024, #23 the June 2026 primary); the Worker starts looking at #24
and remembers the number once November's file appears. If a special election takes #24, it keeps looking.

- Before results, the tab lists every contest and candidate from the Registrar's Aug 28 candidate list.
- Local measures aren't on the candidate list; they appear when the Registrar posts its first count.
- **Calling a local race:** select it, tick the winner(s), pick who made the call, **Call this race**,
  then **Publish call**. Races that elect more than one person (vote for 2, 3 or 4) take that many ticks.
  Withdraw and undo work as on the national board, and calls show in the calls log.
- State Legislature races show **Orange County votes only**; most of those districts cross county lines.
- After election night the Registrar updates weekdays at 5 p.m. until it certifies.

## Free plan or Workers Paid

Cloudflare's free plan allows 100,000 requests a day **per account** (shared with the radar proxy),
50 downloads per run and 10 ms of computing time per run.

- **Free:** the Worker spreads downloads across runs (`SUBREQUEST_BUDGET = "45"`), so every state
  still refreshes within about 15 minutes. But big files (North Carolina, Texas, Florida, Georgia)
  may take more than 10 ms to read, and those states will show "failing".
- **Workers Paid ($5/month):** 30 seconds per run and 10 million requests a month, covering both Workers.
  Set `SUBREQUEST_BUDGET = "500"` and `COUNTY_FEEDS = "on"` in `wrangler.toml` and push, so every state
  refreshes every run and the county maps fill in.
  Plan: stay on the free plan until early November, switch on before election night and before the
  public link gets shared; cancel afterward.

## How it's deployed

- **The board** is part of IntelHQ, so it goes live with IntelHQ whenever `main` changes
  (GitHub Pages at ocscanner.github.io/IntelHQ, and the `intelhq` Cloudflare Worker).
- **The results service** (`oc-election-wire` Worker) rebuilds automatically from `main` too:
  Workers & Pages → oc-election-wire → Settings → Builds, root directory `/elections/worker`, deploy
  command `npx wrangler deploy -c wrangler.toml`. The `-c` matters: without it Cloudflare picks up the
  IntelHQ site's own settings file instead.
- Its database (`oc-election-wire`) and the `DESK_TOKEN` secret are already set up in Cloudflare.

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
top candidates, without saving anything. `state=OC` checks the Orange County Registrar's file. "not posted" means the state hasn't put up its Nov 3 file
yet. Numbers you see before election night are the state's test data.

## Before election night

0. Early November: turn on Workers Paid, then set `SUBREQUEST_BUDGET = "500"` and `COUNTY_FEEDS = "on"`.

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

## The public site

The public Elections page (ocscanner.github.io/PublicSiteTest/elections.html, later ocscanner.news/elections)
is the same board with no desk sign-in, rehearsal switch or Copy post for X, styled to match the site.
Your IntelHQ calls, county maps and the Orange County tab all appear there within about a minute.

It uses copies of this folder's files, so **when `board.js`, `board.css` or anything in `data/` changes
here, copy them to the PublicSiteTest repo's `elections/` folder too**: `board.js`, `board.css`,
`data/us-states.json` and `data/counties/`. If the site moves somewhere other than ocscanner.github.io or
ocscanner.news, add that address to `ALLOWED_ORIGINS` in `wrangler.toml`.

## Streaming the board on X (broadcast mode)

`elections/broadcast.html` is a 1920×1080 results screen made for a livestream. It needs no sign-in and
reads the same data as the public board.

- It rotates every 22 seconds through Senate map, closest races, House map, governors map, flips, and
  Orange County. Flips and Orange County only appear once there's something to show.
- The right side always shows the balance of power for all three chambers and the latest calls.
- When you publish a call, a full-width "RACE CALL" banner appears on the stream for about 9 seconds
  (within about 30 seconds of the call).
- The bottom ticker crawls called races and the closest uncalled Senate and governor races. Before
  results, it shows poll-closing times, and the closest-races screen pages through every race to watch.

**OBS setup:** Sources → + → **Browser** → URL `https://ocscanner.github.io/IntelHQ/elections/broadcast.html`,
width 1920, height 1080. In Settings → Video set both resolutions to 1920×1080. Paste the RTMP URL and
stream key from X Live Studio (x.com/i/live-studio) into Settings → Stream.

**Options** (add to the URL):

| Option | What it does |
|---|---|
| `?sim=1` | Rehearsal data; every screen is labeled REHEARSAL (use it for a private test stream) |
| `?secs=30` | Seconds per screen (default 22) |
| `?scenes=senate,close,house` | Which screens, in order: `senate`, `house`, `governor`, `close`, `flips`, `oc` |

**Steering it live:** in OBS, right-click the source → **Interact**. → and ← change screens, Space pauses
on the current screen, and 1–6 jump to a screen.

If you host the page anywhere other than ocscanner.github.io or ocscanner.news, add that address to
`ALLOWED_ORIGINS` in `worker/wrangler.toml`.

## Candidate names

Every race has its candidates loaded ahead of time, so names show before any results arrive and the desk
call buttons name each candidate: all 435 House races (nominees from the 2026 House elections tables after
the primaries, third-party candidates included), 35 Senate, 36 governor and 152 Orange County races.

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
| `COUNTY_FEEDS` | `off` | County-by-county downloads; `on` with Workers Paid |
| `OC_ELECTION_FROM` | `24` | Orange County results file number to start looking from |
| `SIMULATE` | `false` | Serve rehearsal data by default |

## Worker endpoints

| Path | What it returns |
|---|---|
| `GET /v1/board` | Every race and the seat summaries. Add `?sim=1` for rehearsal data |
| `GET /v1/feed` | Latest calls and withdrawals |
| `GET /v1/counties?race=GA-SEN` | County results for a Senate or governor race |
| `GET /v1/local?area=OC` | Orange County local contests, results and desk calls |
| `GET /v1/health` | Switches, state feed list, when feeds start |
| `GET /v1/desk/preview?state=XX` | Download and parse one state now, without saving (desk token) |
| `POST /v1/desk/call` · `retract` · `clear` · `result` | Desk actions (desk token) |

Run the tests with `npm test` in `elections/worker`.
