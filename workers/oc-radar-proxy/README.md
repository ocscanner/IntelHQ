# oc-radar-proxy

Source copy of the live Cloudflare Worker `oc-radar-proxy` (https://oc-radar-proxy.ocscannernews.workers.dev), saved Nov 10, 2026 as part of P02.

Until now its code lived only in the Cloudflare dashboard (edited with the quick editor; last saved Aug 29, 2026). `src/index.js` matches the live script: same SHA-256 over its non-whitespace characters (`70fccff0…74fb2b`). Indentation was restored by hand, so the bytes differ only in whitespace.

**Nothing here deploys automatically.** No Workers Build is attached to this folder. Running `npx wrangler deploy` from it would replace the live Worker.

## Routes

| Route | Method | What it does | Edge cache | Used by |
|---|---|---|---|---|
| `/flights?lat&lon&dist` | GET | ADS-B aircraft near a point. Tries adsb.lol → airplanes.live → adsb.one; skips empty answers | no-cache | IntelHQ radar, IntelHQ index |
| `/tle?group=` | GET | CelesTrak TLEs (stations, starlink, weather, gps, visual); falls back to tle.ivanstanojevic.me, then stale copy | 300 s | IntelHQ satellites (after the `tle-data` branch) |
| `/tfr` | GET | FAA TFR list from tfr.faa.gov XML | 60 s | Not referenced by either site today |
| `/mil` | GET | Military aircraft worldwide (adsb.lol → airplanes.live) | 15 s | IntelHQ military map |
| `/airports?codes=` | GET | FAA NAS delay status, up to 10 airports | 120 s | IntelHQ traffic |
| `/launches` | GET | Launch Library 2 upcoming launches, cached 45 min in memory | 300 s | Public site Space page, ticker |
| `/rss?url=` | GET | Fetches **any** URL and returns its body as `{contents}` | 120 s | Both sites (news feeds) |
| `/ai-digest` | POST | Claude news digest; serves an in-memory copy, generates when empty or on `force:true` (once per 10 min per isolate) | no-cache | Both sites |
| anything else | GET | Status page listing the routes | — | — |

## Settings on the live Worker

- Secrets: `ANTHROPIC_API_KEY`. (`SPACEDEVS_KEY` is read if present but is not set.)
- Cron triggers: **none.** The `scheduled()` digest never runs. Each fresh Worker instance generates a digest on its first `/ai-digest` call instead.
- CORS: `Access-Control-Allow-Origin: *`. There is no `ALLOWED_ORIGINS` setting.
- Custom domains / routes: none. Only `oc-radar-proxy.ocscannernews.workers.dev`.

## Known issues (see admin/infrastructure-audit.md)

1. Open to every website, and `/ai-digest` spends the Anthropic key. Anyone can send `force:true` and trigger paid calls.
2. `/rss` will fetch any address on the internet.
3. In-memory caches reset whenever Cloudflare starts a new instance.

## Adding adsb.fi (not done; production change)

1. In `/flights`, add `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${dist}` to `apis` as the second entry. Check which key its answer uses for the aircraft list: the code above only accepts `"ac"` or `"states"`, so a different key needs renaming before returning.
2. adsb.fi's terms: about 1 request per second, non-commercial use, credit "adsb.fi". Add `cf: { cacheTtl: 10 }` to its fetch so many viewers share one upstream call.
3. Add `'Access-Control-Expose-Headers': 'X-Source'` to `CORS` so IntelHQ can show the credit when adsb.fi answered.
4. Test on a copy (`name = "oc-radar-proxy-test"`, `npx wrangler deploy`), point a local IntelHQ at it, then deploy for real.
5. Rollback: Workers & Pages → oc-radar-proxy → Deployments → previous version.
