# Election night board

A live results board for the Nov. 3, 2026 midterms: all 435 House seats, 35 Senate races
and 36 governor races on one screen, with a map, the balance of power for each chamber,
a calls log, and desk tools for entering calls yourself. Vote counts refresh from state
election offices about every 10 minutes.

It also has:

- **Zoom into a state.** Select a state and the US map zooms into it. On the Senate and Governors tabs
  it draws the state's counties, colored by who's ahead (stronger color = wider lead). On the House tab
  it draws the state's congressional districts, using the new 2026 lines, each colored like the US map
  (won, leading, striped for a flip) and numbered. Select a district for its race; selecting a House race
  in the list also zooms to its district. Switching tabs keeps you on the same state; select a neighboring
  state to jump there; "← US map" (or Esc) zooms back out. On phones, tap a county or district for its numbers.
- **One level closer.** Inside a state, tap a county or district to zoom in on it and its neighbors (handy for
  LA, the Bay Area or New York); tap a neighbor to move over, "← State" to step back out. Big shapes that
  already fill the view don't zoom further. A trial of the simple version; free pinch/drag zoom is the next step if wanted.
- **An LA County tab**, built like the Orange County one. Before the county posts its Nov 3 ballot it lists the
  12 races that went to November runoffs in the June primary (top two from the county's own June results): LA
  mayor (Bass vs. Raman), city attorney, City Council districts 3 and 9, sheriff (Luna vs. Villanueva), four
  Superior Court seats, Compton mayor and council district 2, Pomona council district 2. Once LA posts the
  election on results.lavote.gov, every local contest on the county's ballot fills in (county offices and measures,
  City of LA, other cities, schools, special districts, Superior Court, State Legislature with LA County votes
  only); federal and statewide contests stay on the national board and CA Props tab. Desk calls work like OC's;
  the 12 runoffs also get model suggestions and DDHQ/AP call matching (mayor, city attorney, sheriff). LA posts no
  precinct count per contest, so races show the count without "% in". The county's site is behind bot protection;
  if it refuses the Worker, the feed (LAC) shows "failing" and alerts.
- **Your own list:** viewers tap **Watch** on any race (any tab) and the **Watching** filter shows just those;
  it's kept on their device.
- **A CA Props tab** with California's 14 statewide propositions (Props 1–5 and 37–45): a scoreboard of
  all 14, Yes/No for each, how Orange County voted on it, and desk calls (passes / fails).
- **An Orange County tab** with every local race on the Nov 3 ballot: 2 county supervisor races,
  77 city races in 31 cities, 47 school and college board races, 12 water and special districts,
  14 state legislative races (OC votes only), and local measures once the Registrar posts them.

It shows up in three places:

- **IntelHQ → Politics & Elections**, under "Live Results Board" (full desk tools)
- **Full screen** at `elections/index.html` (for a second monitor on election night)
- **Public version** at `elections/public.html`: read-only, for ocscanner.media (see below)

```
elections/
  board.js, board.css     the board (no libraries needed)
  index.html              full-screen IntelHQ page
  public.html             read-only page for the public site
  data/races-2026.json    every race: seat holder and named candidates
  data/us-states.json     state shapes for the map
  data/counties/XX.json   county shapes, one small file per state (loaded when you open a state)
  data/districts/XX.json  2026 House district shapes, one file per state (loaded when you open a state on the House tab)
  data/oc-local-2026.json Orange County local contests and candidates
  data/src/oc-local.txt   the OC list it's built from (Registrar's candidate list, Aug 28)
  data/src/*.txt          the race lists the JSON is built from
  tools/build-data.mjs    rebuilds the race list and state shapes
  tools/build-counties.mjs  rebuilds the county shapes and county-name lookup
  tools/build-districts.mjs rebuilds the district shapes from the Census Bureau's 2026 (120th Congress) map.
                            GitHub runs it: Actions → "Build district maps" → Run workflow. Rerun it if a
                            court changes a state's map; it keeps the old file for any state that fails.
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
| **State election offices** | 38 states, below | Free |
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
| TX | **Nov 3 ballot already loaded** (checked Oct 31) on the SOS's new page electionresults.sos.state.tx.us/results.html: Senate, all 38 House seats, governor. "% in" is polling locations reporting |
| NY | **Nov 3 ballot already loaded** (checked Oct 31) on nyenr.elections.ny.gov, a form the feed posts back (governor from the page, all 26 House seats from the U.S. Congress search). Fusion lines (WOR, CON…) are added into each candidate. "% in" is election districts reporting. The site is behind Cloudflare: if it ever shows the Worker a human check, the feed says so and shows "failing"; type those races in with Quick count |
| NM | **Nov 3 file already posted** (checked Oct 24): Senate, governor, 3 House. Same CSV as Nebraska |
| LA | **Nov 3 files already posted** (checked Oct 24): Senate and 6 House seats, Voter Portal JSON |
| SC | Clarity on enr-scvotes.org; files match Colorado's. Nov 3 not listed yet: the feed watches Clarity's list and the scvotes.gov results page for the "General Election" link |
| MD | Unverified. HTML results pages; the June primary's layout was checked. The feed finds November's folder on the 2026 election page (governor, 8 House) |
| OR, MT | Unverified. Same software as NM and Nebraska, but both sites are switched off until Election Day |
| IN | **Nov 3 files already posted** (checked Oct 24): all 9 House seats, results-app JSON |
| MO | Unverified for November. enr.sos.mo.gov is a form (pick election, Submit); the feed posts it the same way, checked Oct 24 against the Aug 4 primary. Starts once "General Election, November 03, 2026" is on the site. 8 House |
| TN | Unverified. tnelectionresults.com is dark until results start; layout checked against Nov 2024. Senate, governor, 9 House |
| AR | **Nov 3 election already loaded** (checked Oct 24) on Arkansas's Tally results site (public JSON API): Senate, governor, 4 House, by county |
| CT | **Nov 3 election already loaded** (checked Oct 24), static JSON; checked against the 2024 general. Cross-endorsed candidates' party lines are added together. Governor, 5 House |
| VT | **Nov 3 files already posted** (checked Oct 24, 0 votes), static JSON summed over towns. Governor, House |
| RI | Enhanced Voting (same as GA and VA); Sept primary checked, Nov 3 not listed yet. Senate, governor, 2 House |
| KS | Unverified for November. Static pages on ent.sos.ks.gov, checked against the Aug primary and the Nov 2022 general; ignored until they're updated on or after Nov 3. Senate, governor, 4 House |
| KY | Unverified for November. One Election Night Reporting page, checked against the archived May primary; "under maintenance" until results start. Senate, 6 House (House races show no "% in": Kentucky only gives a statewide precinct count) |
| HI | Unverified for November. The Office of Elections' summary.txt (2024 general and 2026 primary layouts checked); November's address is a best guess from the primary's. Governor, 2 House |
| DE | Unverified for November. One results page per election (the Sept primary's was /results/enr/PR2026.html); the feed reads only the statewide part of GE2026.html. Senate, House |
| ND | Unverified for November. Statewide results page, checked against the 2024 general it still shows; starts once it says "2026 General Election". House |
| AK | Unverified, **Workers Paid only** (one ~5 MB file). Senate, governor, House. Ranked-choice: first-round counts; no "% in" in Alaska's file |

Check again with the preview tool on Nov 2 or the morning of Nov 3.

States with no free statewide feed (Wisconsin, Massachusetts, Illinois, New Jersey, Michigan,
Nevada, New Hampshire, Maine and others) fill in only from your desk entries or AP; Decision Desk HQ calls
still reach the call queue. Oklahoma's results data needs a login token from its own app, West Virginia's
November election isn't linked anywhere until results start, and Mississippi and Wyoming have no statewide
election-night count (their counties post their own); see the "state feeds survey" project doc. The full state-by-state
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

## CA Props tab

California's 14 statewide propositions on the Nov 3 ballot: Props 1–5 and 37–45 (the list and official
titles are in `data/ca-props-2026.json`, from the Secretary of State's qualified-measures page). Other
states' ballot measures aren't tracked.

- **Results** come from the Secretary of State's election-night API, the same source as California's races:
  `api.sos.ca.gov/returns/ballot-measures` (all 14, statewide) and `.../ballot-measures/county/orange`
  (Orange County's count of the same 14). Two downloads every 10 minutes, so it fits the free plan.
  The SoS already serves practice numbers in that file; the board ignores them until polls close.
- **The scoreboard** shows all 14 at a glance: Yes/No bar, "Yes leads" / "No leads", or **Passes** /
  **Fails** once called. The list below adds the Orange County split; select one for its official title,
  measure type, statewide and Orange County counts.
- **Calling a proposition:** select it, choose **Yes (passes)** or **No (fails)**, pick who made the call,
  **Call this measure**, then **Publish call**. Withdraw and undo work as for races, and calls show in the
  calls log as "Prop 39 fails". **Copy post for X** writes the call or the current count.
- Statewide propositions pass with a simple majority. California counts mail ballots for weeks, so close
  ones can take days to call; the percentage shown is precincts reporting, not ballots counted.

## Phone alerts (desk only)

Your phone can buzz when something needs you, even with IntelHQ closed. It uses standard web push (what
installed web apps use): no app store and no outside service. Turn it on from the call queue: **Phone alerts →
Turn on alerts on this device**, then **Send a test alert**.

- **What alerts:** Decision Desk HQ / AP calls (and calls the watcher couldn't match), high-confidence model
  calls, and feed failures (one alert when a state's feed breaks, one when it works again). Conflicts are off by
  default. Each device keeps its own choices. Tapping an alert opens that race on the board.
- **Busy moments:** more than 3 of one kind in the same minute arrive as one alert ("12 network calls waiting").
- **iPhone:** works from the Home Screen app only (iOS 16.4 or later): Safari → Share → Add to Home Screen, open
  IntelHQ from the Home Screen, sign in to the desk there (it doesn't share Safari's sign-in), turn alerts on.
- **Android / computer:** Chrome, Edge or Firefox; allow notifications when asked.
- **When:** queue and feed alerts start with results on Nov 3; the test alert works any time.
- The Worker makes its own signing key on first use and keeps it in the database, so there's nothing to paste.
- Public alerts for published calls (opt-in on the public page) are a possible next step; not built.

## Issue log (for the 2028 rebuild)

Everything that broke or needed a hand on election night, in the call queue under **Issue log**:

- **Written automatically:** a state's feed failing, working again, or going dark after having results; DDHQ/AP
  calls the watcher couldn't match to a race, or named someone not on our candidate list; network calls that
  disagreed with the board; races whose counts had to be typed in (once per race); withdrawn calls.
- **Your notes:** **Log issue** adds a one-line note, tagged to the race you have open.
- **Copy the whole log** gives a plain-text report grouped by kind, ready to become the 2028 rebuild doc.
- Rehearsal activity is never logged.

## Quick count (desk only)

One screen in the call queue for typing in counts for close races in states with no automatic feed. It starts
with 24 races, ranked by how competitive they are (Oct 31): Michigan governor, Senate, MI-7, MI-8, MI-4, MI-10;
NY-17, NY-22, NY-3, NY-4, NY-19; Wisconsin governor, WI-3, WI-1; Nevada governor, NV-3; Maine Senate, governor,
ME-2; New Hampshire Senate, governor, NH-1; NJ-7; IL-17. Add or remove races from a race's detail panel
(**Add to / Remove from Quick count**); the list is kept per device.

- Each row: % in, then the Democrat's and the Republican's votes (always in that order). **Save** or Enter.
- **Save all** saves every row you've typed in. Rows show "Saved 2m ago", "Feed: …" or "Called: …".
- It saves through **Enter vote counts**, so a state feed or AP, when there is one, still takes over.

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
- **Preview builds are turned off** for `oc-election-wire` (Settings → Builds → Previews Base → "Builds for
  Preview branches"). Cloudflare turned them on for every Worker in Oct 2026; a preview of this Worker has no
  database or feeds, and its default command (`npx wrangler preview`, no `-c`) read the wrong settings file,
  so it failed on every push. If you ever turn previews back on, set the Preview command to
  `npx wrangler preview -c wrangler.toml`.
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

## Checking a state's feed (Feed check)

In the call queue, **Feed check** lists every feed (unverified ones first). **Check** runs that state's feed
right now from the Worker, the same way election night will, without saving anything; **Check all unverified**
runs them one after another. Results:

- **Working: N races** with the first two races' top candidates (before Nov 3, the state's test numbers or zeros).
- **Not posted yet:** the Worker reached the site but November isn't up. Normal before Nov 3.
- **Failing:** the Worker couldn't get the data (a block, a human check, a changed page). For New York it says
  so when Cloudflare shows the Worker a human check.

The same check from Terminal (change `GA` to any feed state; no state gives the list of feeds):

```bash
curl -H "Authorization: Bearer YOUR_DESK_TOKEN" "https://oc-election-wire.ocscannernews.workers.dev/v1/desk/preview?state=GA"
```

`state=OC` checks the Orange County Registrar's file, `state=LAC` LA County's.

## Before election night

0. Early November: turn on Workers Paid, then set `SUBREQUEST_BUDGET = "500"` and `COUNTY_FEEDS = "on"`.

1. Open the board and turn on **Rehearsal data**. It plays a fake election night on a
   90-minute loop so you can practice. Everything in rehearsal is labeled, copied posts start
   with "[REHEARSAL, NOT REAL RESULTS]", and rehearsal desk calls are stored separately from real ones.
2. Click **Desk sign-in** and enter your `DESK_TOKEN`. Practice a call and a withdrawal.
3. Star the races you care about. **Chime on watched calls** plays a tone when one is called.
4. Turn rehearsal off. The board should say "No results yet" and "State feeds start Nov 3, 2:00 PM".
5. Run the preview tool for each state on Nov 2 or the morning of Nov 3.

## Call queue (desk only)

When you're signed in to desk mode on IntelHQ, a **Call queue** panel sits above Latest calls (the
**Call queue** button at the top jumps to it and shows the count, and so does the browser tab title).
It never appears on the public site, and its data needs the desk token.

What lands in the queue:

- **Decision Desk HQ calls.** Every minute the Worker reads DDHQ's Bluesky feed (free, open API, no account)
  and picks out posts like "Decision Desk HQ projects … wins the IA US Senate". Each is matched to our race
  by state, office and candidate name.
- **AP calls** from @AP_RaceCalls, only if you add an X API key (see below). Off by default.
- **Model suggestions** ("OC Scanner model") when our own counts say a race is effectively over: unopposed,
  a blowout, or the trailing candidate would need 80%+ of the votes still to come (**High**; 70%+ is
  **Medium**). In slow-count states (CA, WA, OR, NV, AZ, UT, CO, AK, HI), and for the propositions and OC
  races, it only looks at the lead (20+ pts high, 12+ medium), because "100% of precincts" there can still
  leave weeks of mail ballots. Georgia, Alaska and Maine need a majority first.
- **Conflicts** (top of the list): DDHQ or AP called a race differently from the call on your board.
- **Couldn't match**: a call post the Worker couldn't tie to a race, so it isn't silently lost.

Working it:

- **Publish** takes two taps. The call goes on the board credited to the source (Decision Desk HQ, AP,
  or OC Scanner desk for model calls) and shows in Latest calls. Withdraw it like any other call.
- **Publish all …** buttons handle a batch (all DDHQ calls, all AP calls, or all high-confidence model
  calls) after a confirmation listing them. Conflicts are always one at a time.
- **Dismiss** removes an item. A dismissed Medium suggestion comes back if it becomes High.
- Items older than 5 minutes turn amber, 15 minutes red. A chime plays when something new arrives
  (with "Chime on watched calls" on), even if the tab is in the background.
- Calls already on the board the same way clear themselves.
- Rehearsal data fills the queue with practice DDHQ calls and model suggestions so you can drill it.
- **Test DDHQ feed** (under the panel title) reads DDHQ's feed right now and tells you whether it works.
  Before Nov 3 it should say "no November calls yet".

The watcher starts at RESULTS_START (Nov 3, 3 p.m. Pacific) and ignores anything DDHQ posted earlier.
DDHQ's general-election wording is assumed from its primary-night posts; anything that doesn't parse
cleanly shows as "couldn't match", and the model and your own eyes cover what DDHQ doesn't post.

**Adding AP (optional):** create an X developer account with pay-per-use credit (about $0.005 per post read;
election week should be roughly $10–30), copy its Bearer Token, then in `elections/worker` run
`npx wrangler secret put X_BEARER_TOKEN` and paste it. The queue's status line then shows "AP on".

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

The public Elections page (ocscanner.github.io/PublicSiteTest/elections.html, later ocscanner.media/elections)
is the same board with no desk sign-in, rehearsal switch or Copy post for X, styled to match the site.
Your IntelHQ calls, county maps, the CA Props tab and the Orange County tab all appear there within about a minute.

It uses copies of this folder's files, so **when `board.js`, `board.css` or anything in `data/` changes
here, copy them to the PublicSiteTest repo's `elections/` folder too**: `board.js`, `board.css`,
`data/us-states.json`, `data/counties/` and `data/districts/`. If the site moves somewhere other than ocscanner.github.io or
ocscanner.media, add that address to `ALLOWED_ORIGINS` in `wrangler.toml`.

## Streaming the board on X (broadcast mode)

`elections/broadcast.html` is a 1920×1080 results screen made for a livestream. It needs no sign-in and
reads the same data as the public board.

- It rotates every 22 seconds through Senate map, closest races, House map, governors map, flips, and
  Orange County. Flips and Orange County only appear once there's something to show.
- The right side always shows the balance of power for all three chambers and the latest calls.
- Calls reach the stream within about 30 seconds of publishing (see the auto-director below).
- The bottom ticker crawls called races and the closest uncalled Senate and governor races. Before
  results, it shows poll-closing times, and the closest-races screen pages through every race to watch.

**Auto-director** (on by default). Between rotation screens, it cuts to what just happened:

| What happens | What it shows | Tag on screen |
|---|---|---|
| A party reaches a majority from called seats (Senate: 51, or 50 for Republicans with the VP) | That chamber's map with the headline | MAJORITY |
| A Senate or governor race is called, or any seat flips | A full screen for that race: candidates, votes, who called it | JUST CALLED / FLIP |
| The leader changes in a Senate or governor race with at least 20% counted | That race | LEAD CHANGE |
| A Senate or governor race tightens under 1 point with at least half counted | That race | NECK AND NECK |

It only uses vote counts and calls already on the board, and never calls a race itself. Independents
aren't counted toward either party for the majority headline. Calls cut in after a few seconds; at most
three play back to back before a regular screen gets its full turn. Lead changes and tight races wait
for the current screen to finish. Anything that stops being true before its turn (a lead that flips
back, a call that's withdrawn) is skipped. Press **A** to turn it off or on, or add `?director=0`.

With the auto-director on, banners are kept for Orange County calls, withdrawn calls, and California
House seats; Senate, governor and flip calls get their full screen instead. Other House calls appear in
the latest calls list and the ticker.

**OBS setup:** Sources → + → **Browser** → URL `https://ocscanner.github.io/IntelHQ/elections/broadcast.html`,
width 1920, height 1080. In Settings → Video set both resolutions to 1920×1080. Paste the RTMP URL and
stream key from X Live Studio (x.com/i/live-studio) into Settings → Stream.

**Options** (add to the URL):

| Option | What it does |
|---|---|
| `?sim=1` | Rehearsal data; every screen is labeled REHEARSAL (use it for a private test stream) |
| `?secs=30` | Seconds per screen (default 22) |
| `?scenes=senate,close,house` | Which screens, in order: `senate`, `house`, `governor`, `close`, `flips`, `oc` |
| `?director=0` | Turn the auto-director off (plain rotation) |

**Steering it live:** in OBS, right-click the source → **Interact**. → and ← change screens, Space pauses
on the current screen, 1–6 jump to a screen, and A turns the auto-director on or off.

If you host the page anywhere other than ocscanner.github.io or ocscanner.media, add that address to
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
| `GET /v1/local?area=CAP` | California's propositions: statewide Yes/No, Orange County's count, desk calls |
| `GET /v1/health` | Switches, state feed list, when feeds start |
| `GET /v1/desk/preview?state=XX` | Download and parse one state now, without saving (desk token) |
| `POST /v1/desk/call` · `retract` · `clear` · `result` | Desk actions (desk token) |
| `GET /v1/desk/queue` · `POST /v1/desk/queue` | The call queue; publish or dismiss items (desk token) |
| `GET /v1/desk/watch` | Read DDHQ's Bluesky feed now and show how each post parses (desk token) |

Run the tests with `npm test` in `elections/worker`.
