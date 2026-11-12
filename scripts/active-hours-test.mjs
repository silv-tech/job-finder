// Proves the scheduled-cycle window, including the malformed-config fallbacks.
//   node scripts/active-hours-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const grab = (name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const DEFAULT_CONFIG = { activeStartHour: 8, activeEndHour: 22 };
const ctx = eval(`(() => { ${grab('pad2')} ${grab('activeHours')} ${grab('withinActiveHours')}
  return { pad2, activeHours, withinActiveHours }; })()`);
const { activeHours, withinActiveHours } = ctx;

const at = (h, m = 0) => { const d = new Date(2026, 10, 13, h, m); return d; };
let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(` ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(50)} ${JSON.stringify(got)}${ok ? '' : '  want ' + JSON.stringify(want)}`);
};

console.log('--- default 8:00 to 22:00 ---');
for (const [h, want] of [[0,false],[7,false],[8,true],[12,true],[21,true],[22,false],[23,false]]) {
  check(`${String(h).padStart(2,'0')}:00 runs?`, withinActiveHours({}, at(h)), want);
}
check('07:59 runs?', withinActiveHours({}, at(7,59)), false);
check('21:59 runs?', withinActiveHours({}, at(21,59)), true);

console.log('--- custom window respected ---');
check('06-18 at 06:00', withinActiveHours({activeStartHour:6,activeEndHour:18}, at(6)), true);
check('06-18 at 18:00', withinActiveHours({activeStartHour:6,activeEndHour:18}, at(18)), false);

console.log('--- malformed config falls back, never locks out the day ---');
for (const cfg of [
  {activeStartHour:22,activeEndHour:8},            // inverted
  {activeStartHour:'abc',activeEndHour:'xyz'},     // junk
  {activeStartHour:-5,activeEndHour:99},           // out of range
  {activeStartHour:10,activeEndHour:10},           // zero-width
  {},                                              // absent
  undefined,                                       // no config at all
]) {
  check(`${JSON.stringify(cfg)} -> hours`, activeHours(cfg), {start:8,end:22});
}
console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
