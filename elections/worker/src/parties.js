// Normalize the many party spellings used by AP, state feeds and desk input.
const MAP = {
  D: 'D', DEM: 'D', DEMOCRAT: 'D', DEMOCRATIC: 'D', DFL: 'D',
  R: 'R', REP: 'R', GOP: 'R', REPUBLICAN: 'R',
  I: 'I', IND: 'I', INDEPENDENT: 'I', NPP: 'I', NPA: 'I', UNA: 'I', NON: 'I',
  L: 'L', LIB: 'L', LIBERTARIAN: 'L',
  G: 'G', GRN: 'G', GREEN: 'G',
};
export function normParty(p) {
  if (!p) return 'O';
  const raw = String(p).trim().toUpperCase();
  const key = raw.replace(/[^A-Z]/g, '');
  if (MAP[key]) return MAP[key];
  // Long forms: "Democratic Party Nominees", "Prefers Republican Party", "Democratic-Farmer-Labor"
  if (/DEMOCRAT|FARMER.?LABOR/.test(raw)) return 'D';
  if (/REPUBLICAN/.test(raw)) return 'R';
  if (/LIBERTARIAN/.test(raw)) return 'L';
  if (/GREEN/.test(raw)) return 'G';
  if (/INDEPENDENT|NO PARTY|UNAFFILIATED|NONPARTISAN|NON-PARTISAN/.test(raw)) return 'I';
  return 'O';
}
export const toNum = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%\s"=]/g, ''));
  return Number.isFinite(n) ? n : null;
};
