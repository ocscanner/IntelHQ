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
  return MAP[String(p).trim().toUpperCase().replace(/[^A-Z]/g, '')] || 'O';
}
export const toNum = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
