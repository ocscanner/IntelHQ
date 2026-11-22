// Run: node --test test/wxcard.test.js   (no packages needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../wxcard.js');

test('hazard colours follow the NWS map, with a fallback', () => {
  assert.equal(C.hazardColor('Red Flag Warning'), '#FF1493');
  assert.equal(C.hazardColor('Flash Flood Warning'), '#8B0000');
  assert.equal(C.hazardColor('Something New'), '#00B4FF');
});

test('warning types pick the right template', () => {
  assert.equal(C.warningType('Red Flag Warning'), 'fire');
  assert.equal(C.warningType('Fire Weather Watch'), 'fire');
  assert.equal(C.warningType('Wind Advisory'), 'wind');
  assert.equal(C.warningType('High Wind Warning'), 'wind');
  assert.equal(C.warningType('Extreme Heat Warning'), 'heat');
  assert.equal(C.warningType('Flash Flood Warning'), 'rain');
  assert.equal(C.warningType('Severe Thunderstorm Warning'), 'rain');
  assert.equal(C.warningType('Dense Fog Advisory'), 'fog');
  assert.equal(C.warningType('High Surf Advisory'), 'coast');
  assert.equal(C.warningType('Coastal Flood Advisory'), 'coast');
  assert.equal(C.warningType('Air Quality Alert'), 'other');
});

test('text colour stays readable on light and dark bands', () => {
  assert.equal(C.textOn('#FFDEAD'), '#0b1726');
  assert.equal(C.textOn('#8B0000'), '#ffffff');
});

test('captions use only the alert facts and fit on X', () => {
  const p = {
    event: 'Red Flag Warning',
    areaDesc: 'Santa Ana Mountains and Foothills; Orange County Inland Areas',
    expires: '2026-11-22T02:00:00Z', senderName: 'NWS San Diego CA',
  };
  const c = C.alertCaption(p);
  assert.match(c, /^Red Flag Warning for Santa Ana Mountains and Foothills, Orange County Inland Areas until Sat, Nov 21, 6:00 PM\./);
  assert.match(c, /Source: NWS San Diego CA/);
  assert.ok(c.length <= 280);
  const long = Object.assign({}, p, { areaDesc: Array.from({ length: 30 }, (_, i) => 'Very Long Zone Name Number ' + i).join('; ') });
  assert.ok(C.alertCaption(long).length <= 280);
  assert.equal(C.alertCaption(p, '').split('\n').length, 2);
});

test('area lists shorten after three', () => {
  assert.equal(C.shortAreas('A; B; C; D; E', 3), 'A, B, C and 2 more');
  assert.equal(C.shortAreas('A; B', 3), 'A, B');
});

test('fire and storm captions', () => {
  assert.equal(C.fireCaption({ name: 'Ridge', county: 'Orange', acres: 1234.4, pct: 15 }), 'Ridge fire, Orange County: 1,234 acres, 15% contained.\nSource: NIFC incident data\n#OCFire');
  assert.match(C.fireCaption({ name: 'X' }), /size not yet reported, containment not yet reported/);
  assert.match(C.stormCaption({ status: 'crit', crit: 2, warn: 3, total: 17, peak: { gust: 52.3, name: 'Fullerton' } }), /^OC Storm Index: Critical\. 2 critical and 3 elevated of 17 weather stations\. Peak gust 52 mph at Fullerton\./);
});

test('map fitting keeps the area inside the frame', () => {
  const v = C.fitView(C.OC_BBOX, 1600, 676);
  const [w, s, e, n] = C.OC_BBOX;
  const x1 = C.lon2x(w, v.z) - v.left, x2 = C.lon2x(e, v.z) - v.left;
  const y1 = C.lat2y(n, v.z) - v.top, y2 = C.lat2y(s, v.z) - v.top;
  assert.ok(x1 >= 0 && x2 <= 1600 && y1 >= 0 && y2 <= 676);
  assert.ok(v.z >= 9 && v.z <= 11);
});

test('bbox helpers', () => {
  const g = { type: 'Polygon', coordinates: [[[-117.9, 33.6], [-117.7, 33.6], [-117.7, 33.8], [-117.9, 33.6]]] };
  assert.deepEqual(C.bboxOf([g, null]), [-117.9, 33.6, -117.7, 33.8]);
  assert.equal(C.bboxOf([]), null);
  const c = C.clampBbox([-117.81, 33.69, -117.8, 33.7]);       // tiny area grows to a readable view
  assert.ok(c[2] - c[0] >= 0.499 && c[3] - c[1] >= 0.349);
  assert.deepEqual(C.clampBbox(null), C.OC_BBOX);
  const far = C.clampBbox([-125, 30, -100, 45]);                // clipped to SoCal
  assert.ok(far[0] >= -120.7 && far[2] <= -114.1);
});

test('timing uses onset/ends, not the message expiry', () => {
  const now = new Date('2026-11-21T13:00:00-08:00').getTime();
  const watch = { event: 'Coastal Flood Watch', areaDesc: 'Orange County Coastal', senderName: 'NWS San Diego CA',
    onset: '2026-11-24T04:00:00-08:00', expires: '2026-11-21T21:00:00-08:00', ends: '2026-11-26T13:00:00-08:00' };
  assert.equal(C.timingText(watch, now), 'from Tue, Nov 24, 4:00 AM until Thu, Nov 26, 1:00 PM');
  assert.match(C.alertCaption(watch, undefined, now), /^Coastal Flood Watch for Orange County Coastal from Tue, Nov 24, 4:00 AM until Thu, Nov 26, 1:00 PM\./);
  const running = Object.assign({}, watch, { onset: '2026-11-21T10:00:00-08:00' });
  assert.equal(C.timingText(running, now), 'until Thu, Nov 26, 1:00 PM');
  const noEnds = { onset: '2026-11-21T10:00:00-08:00', expires: '2026-11-21T21:00:00-08:00' };
  assert.equal(C.timingText(noEnds, now), 'until Sat, Nov 21, 9:00 PM');
  assert.equal(C.timingText({}, now), '');
});
