#!/usr/bin/env bash
# Downloads satellite orbits (TLEs) from CelesTrak for the IntelHQ Radar tab.
# Run by .github/workflows/satellite-data.yml; writes into the folder given as $1.
#
# CelesTrak's rules (celestrak.org/usage-policy.php): each list updates every
# 2 hours, so download it at most once per update, and stop asking as soon as
# it answers with anything other than 200. This script runs every 6 hours and
# fetches Starlink (an enforced-limit list) only once a day. On any error it
# keeps the previous copy and makes no further requests this run.
set -u
OUT="${1:?output folder}"
mkdir -p "$OUT"
UA="OC-Scanner-IntelHQ/1.0 (+https://ocscanner.media; satellite radar, fetched every 6h)"
HOUR=$(date -u +%H)

# file name : CelesTrak group
LISTS="stations:stations visual:visual weather:weather gps:gps-ops"
# Starlink once a day (the 00:xx UTC run), or when we don't have it yet.
if [ "$HOUR" -lt 6 ] || [ ! -s "$OUT/starlink.txt" ]; then LISTS="$LISTS starlink:starlink"; fi

stopped=""
FETCHED=""
for pair in $LISTS; do
  file="${pair%%:*}"; group="${pair##*:}"
  if [ -n "$stopped" ]; then echo "skip $group (stopped after an error)"; continue; fi
  tmp=$(mktemp)
  code=$(curl -sS -m 60 -A "$UA" -o "$tmp" -w '%{http_code}' \
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE" || echo 000)
  lines=$(grep -c '^1 ' "$tmp" || true)
  if [ "$code" = "200" ] && [ "${lines:-0}" -gt 0 ]; then
    mv "$tmp" "$OUT/$file.txt"
    FETCHED="$FETCHED $file"
    echo "ok   $group: $lines satellites"
  else
    echo "FAIL $group: HTTP $code, $(head -c 120 "$tmp" | tr '\n' ' ')"
    rm -f "$tmp"
    stopped=1   # CelesTrak asks clients to stop on any non-200
  fi
  sleep 3
done

# meta.json: satellites and last-refresh time (UTC) per file. Files not
# refetched this run keep their earlier time.
[ -s "$OUT/meta.json" ] || echo '{}' > "$OUT/meta.json"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for f in $FETCHED; do
  n=$(grep -c '^1 ' "$OUT/$f.txt")
  jq --arg f "$f" --argjson n "$n" --arg t "$NOW" '.[$f] = {satellites: $n, updated: $t}' \
    "$OUT/meta.json" > "$OUT/meta.tmp" && mv "$OUT/meta.tmp" "$OUT/meta.json"
done
cat "$OUT/meta.json"
[ -z "$stopped" ]
