// County name matching. State files name counties many ways ("DeKalb", "DE KALB", "Contra Costa County",
// "contra-costa", "Richmond City"); the map uses census FIPS codes. countyKey() reduces a name to a
// key that matches the key built from the census name (see tools/build-counties.mjs).
import FIPS_BY_NAME from '../county-fips.json' with { type: 'json' };

/**
 * @param {string} name  county name as a state file writes it
 * @param {boolean} [indepCity] true when the census record is an independent city (Virginia, etc.)
 */
export function countyKey(name, indepCity = false) {
  let s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  s = s.replace(/-/g, ' ').replace(/\s+/g, ' ');
  let city = indepCity;
  const cityOf = s.match(/^city of (.+)$/);
  if (cityOf) { s = cityOf[1]; city = true; }
  if (/ city$/.test(s) && !indepCity) {
    // "Richmond City" (Virginia independent city) vs "James City" / "Charles City" (counties)
    if (!/^(james|charles) city$/.test(s) && !/ city county$/.test(s)) { s = s.replace(/ city$/, ''); city = true; }
  }
  s = s.replace(/ (county|parish|borough|census area|city and borough|municipality)$/, '');
  s = s.replace(/^(saint|ste?\.?) /, 'st ');
  s = s.replace(/[^a-z]/g, '');
  return city ? `${s}~city` : s;
}

/** FIPS code for a county in a state, or null. */
export function countyFips(st, name) {
  const table = FIPS_BY_NAME[st];
  if (!table) return null;
  const k = countyKey(name);
  return table[k] || (k.endsWith('~city') ? table[k.slice(0, -5)] : null) || null;
}

/** Minnesota's county numbers run 1–87 in alphabetical order, as do its FIPS codes (27001, 27003…). */
export const mnCountyFips = n => { const i = parseInt(n, 10); return i >= 1 && i <= 87 ? String(27000 + i * 2 - 1) : null; };
