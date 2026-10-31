# livery-board Worker

The flight schedule service behind **News → Special Liveries** in IntelHQ.

At 6 AM Pacific it looks up today's flights for every special-livery tail on AeroDataBox, and at 6 PM it looks up tomorrow's. It saves the results in Cloudflare KV, and the tracker page (`liveries/index.html`) reads them from `GET /board`. Page visitors never call AeroDataBox, so the cost doesn't change with traffic.

- **Tail list:** `liveries/liveries.json` in this repo, read from GitHub, so updating that file updates what gets checked.
- **Address:** `https://livery-board.ocscannernews.workers.dev`. If Cloudflare gives it a different one, change `BOARD_URL` near the top of the script in `liveries/index.html`.

## One-time setup (about 15 minutes, all in the browser)

### 1. Get an AeroDataBox key
1. Sign in at rapidapi.com and open the **AeroDataBox** API.
2. Subscribe to a plan. The free **Basic** plan is fine for testing. It won't cover full daily use (see Cost).
3. Copy your **X-RapidAPI-Key** from the code-snippet panel.

### 2. Create the Worker from this repo
Same setup as `oc-election-wire`, so it rebuilds by itself whenever `main` changes.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick `ocscanner/IntelHQ`.
2. Settings:
   - **Project name:** `livery-board`
   - **Root directory:** `/liveries/worker`
   - **Deploy command:** `npx wrangler deploy -c wrangler.toml`

   The `-c` matters. Without it Cloudflare picks up the IntelHQ site's own settings file instead.
3. **Deploy.** The first build also creates the KV storage and the 15-minute schedule from `wrangler.toml`.
4. Turn off preview builds: **Settings → Builds → Previews** → turn off "Builds for preview branches". A preview copy has no key or storage, so it would only fail.

### 3. Add the two secrets
Worker → **Settings** → **Variables and Secrets** → **Add**, type **Secret**:

| Name | Value |
|---|---|
| `RAPIDAPI_KEY` | your key from step 1 |
| `ADMIN_KEY` | any password you make up. It unlocks the test and status links below. |

### 4. Test with 3 tails
Open in a browser (replace `YOURPASSWORD`):

```
https://livery-board.ocscannernews.workers.dev/run?key=YOURPASSWORD&limit=3
```

You should see `"processed": 3`. Open `/board` on the same address to see the saved flights, then load News → Special Liveries in IntelHQ. To check that tomorrow's flights come back, add `&day=tomorrow`.

From here it runs on its own. If you test after 6 AM, the first scheduled check happens within 15 minutes.

## Checking on it

```
https://livery-board.ocscannernews.workers.dev/status?key=YOURPASSWORD
```

Shows this month's AeroDataBox call count, the last run, whether one is in progress, and the last error:

- **429:** rate limited or out of quota. It retries every 15 minutes and gives up on that check after an hour.
- **401 / 403:** the key is wrong, or the AeroDataBox subscription lapsed. The run stops.

## Settings (`wrangler.toml`)

| Name | Default | What it does |
|---|---|---|
| `RUN_PLAN` | `6:today,18:tomorrow` | When to check, in Pacific hours. `18:tomorrow` alone halves the cost. |
| `SKIP_DECALS` | `true` | Skips the Southwest nose-decal-only jets, which are hard to spot anyway. |
| `SUBREQUEST_BUDGET` | `40` | AeroDataBox calls per wake-up. The free Workers plan allows 50 outside calls. |
| `ROSTER_URL` | raw GitHub copy of `liveries.json` | Where the tail list comes from. |

Change a setting by editing `wrangler.toml` and pushing to `main`. Settings changed in the dashboard get overwritten by the next build.

## Cost

- **Cloudflare:** free plan. This uses 1 of the account's 5 scheduled triggers (the election Worker uses 2).
- **AeroDataBox:** about 71 tails × 2 checks a day ≈ **4,300 calls a month**. Each lookup by registration is a Tier 2 call, which can cost more than 1 unit, so check the unit price on your RapidAPI plan page after testing. Watch `/status` for a few days to see real usage.

## Tests

```bash
cd liveries/worker
npm install
npm test
```

They run the Worker against a fake AeroDataBox and fake storage: batching, today plus tomorrow, rate limits, a bad key, and the routes.
