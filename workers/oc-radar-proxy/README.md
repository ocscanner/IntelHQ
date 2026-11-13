# oc-radar-proxy

Source of the Cloudflare Worker `oc-radar-proxy` (https://oc-radar-proxy.ocscannernews.workers.dev).

- **v9** was copied from the Cloudflare dashboard on Nov 10, 2026 (commit `a4939a9`, matches the live script).
- **v10** (Nov 10, 2026) adds the P02 security fixes:
  - Only OC Scanner's own sites may call it (`ALLOWED_ORIGINS`); other websites get 403.
  - `/rss` only fetches feeds from `FEED_HOSTS`. **Adding a news feed to IntelHQ or the public site? Add its host there too**, or that feed comes back empty.
  - `/ai-digest` ignores headlines and `force` sent by callers. The digest is made 3 times a day by the cron schedule and stored in KV (`DIGEST_KV`), so visitors never cause paid Claude calls and can't change what it says.

Deployed Nov 12, 2026 (version `9b5c2b16`) by pasting `src/index.js` into the dashboard editor; KV binding and cron were set in the dashboard to match `wrangler.toml`.
Deploy later changes: `npx wrangler deploy` from this folder, or paste into the dashboard editor. Tests: `node --test test/proxy.test.mjs`.

## Routes

| Route | Method | What it does | Edge cache | Used by |
|---|---|---|---|---|
| `/flights?lat&lon&dist` | GET | ADS-B aircraft near a point. Tries adsb.lol → airplanes.live → adsb.one; skips empty answers | no-cache | IntelHQ radar, IntelHQ index |
| `/tle?group=` | GET | CelesTrak TLEs (stations, starlink, weather, gps, visual); falls back to tle.ivanstanojevic.me, then stale copy | 300 s | IntelHQ satellites (after the `tle-data` branch) |
| `/tfr` | GET | FAA TFR list from tfr.faa.gov XML | 60 s | Not referenced by either site today |
| `/mil` | GET | Military aircraft worldwide (adsb.lol → airplanes.live) | 15 s | IntelHQ military map |
| `/airports?codes=` | GET | FAA NAS delay status, up to 10 airports | 120 s | IntelHQ traffic |
| `/launches` | GET | Launch Library 2 upcoming launches, cached 45 min in memory | 300 s | Public site Space page, ticker |
| `/rss?url=` | GET | Fetches an approved feed (`FEED_HOSTS`) and returns its body as `{contents}` | 120 s | Both sites (news feeds) |
| `/ai-digest` | POST | The scheduled Claude news digest from KV (body ignored) | no-cache | Both sites |
| anything else | GET | Status page listing the routes | — | — |

## Settings

- Secrets: `ANTHROPIC_API_KEY`. (`SPACEDEVS_KEY` is read if present but is not set.)
- Cron: `0 5,16,22 * * *` (one trigger; 05:00, 16:00, 22:00 UTC). KV: `DIGEST_KV`, key `digest`.
- Routes without an Origin header (opening the address directly): only `/`, `/flights`, `/tle`, `/tfr`, `/mil`, `/airports`, `/launches`.
- Custom domains / routes: none. Only `oc-radar-proxy.ocscannernews.workers.dev`.
- In-memory caches (TLE, launches) still reset when Cloudflare starts a new instance.

## Adding adsb.fi (not done; production change)

1. In `/flights`, add `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${dist}` to `apis` as the second entry. Check which key its answer uses for the aircraft list: the code above only accepts `"ac"` or `"states"`, so a different key needs renaming before returning.
2. adsb.fi's terms: about 1 request per second, non-commercial use, credit "adsb.fi". Add `cf: { cacheTtl: 10 }` to its fetch so many viewers share one upstream call.
3. Add `'Access-Control-Expose-Headers': 'X-Source'` to `CORS` so IntelHQ can show the credit when adsb.fi answered.
4. Test on a copy (`name = "oc-radar-proxy-test"`, `npx wrangler deploy`), point a local IntelHQ at it, then deploy for real.
5. Rollback: Workers & Pages → oc-radar-proxy → Deployments → previous version.
