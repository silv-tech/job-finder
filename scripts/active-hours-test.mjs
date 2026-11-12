// Proves the scheduled-cycle window, including the malformed-config fallbacks.
//   node scripts/active-hours-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const grab = (name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by the eval'd activeHours()
const DEFAULT_CONFIG = { activeWindows: [[7, 11], [20, 23]] };
const ctx = eval(`(() => { ${grab('pad2')} ${grab('activeHours')} ${grab('withinActiveHours')} ${grab('activeHoursText')}
  return { pad2, activeHours, withinActiveHours, activeHoursText }; })()`);
const { activeHours, withinActiveHours, activeHoursText } = ctx;

const at = (h, m = 0) => new Date(2026, 10, 13, h, m);
let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(` ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(50)} ${JSON.stringify(got)}${ok ? '' : '  want ' + JSON.stringify(want)}`);
};

console.log('--- default: 07:00-11:00 and 20:00-23:00 ---');
for (const [h, want] of [
  [0,false],[6,false],[7,true],[10,true],[11,false],[15,false],
  [19,false],[20,true],[22,true],[23,false],
]) check(`${String(h).padStart(2,'0')}:00 runs?`, withinActiveHours({}, at(h)), want);
check('06:59 runs?', withinActiveHours({}, at(6,59)), false);
check('10:59 runs?', withinActiveHours({}, at(10,59)), true);
check('22:59 runs?', withinActiveHours({}, at(22,59)), true);
check('the dead middle of the day is off', withinActiveHours({}, at(13)), false);

console.log('--- a custom pair of windows ---');
const cfg = { activeWindows: [[6, 9], [18, 20]] };
for (const [h, want] of [[5,false],[6,true],[8,true],[9,false],[17,false],[18,true],[19,true],[20,false]])
  check(`06-09/18-20 at ${h}:00`, withinActiveHours(cfg, at(h)), want);

console.log('--- malformed never locks out the whole day ---');
for (const c of [
  { activeWindows: [] },
  { activeWindows: [[11, 7]] },
  { activeWindows: [['x', 'y']] },
  { activeWindows: [[-5, 99]] },
  { activeWindows: [[10, 10]] },
  { activeWindows: 'nope' },
  { activeWindows: [[7]] },
  {},
  undefined,
]) check(`${JSON.stringify(c)} -> windows`, activeHours(c), [[7,11],[20,23]]);

console.log('--- one bad window does not discard a good one ---');
check('[[7,11],[11,7]] keeps the good one', activeHours({ activeWindows: [[7,11],[11,7]] }), [[7,11]]);

console.log('--- the stand-down note reads properly ---');
check('default text', activeHoursText({}), '07:00-11:00 and 20:00-23:00');
check('single window text', activeHoursText({ activeWindows: [[9, 17]] }), '09:00-17:00');

console.log('--- a stand-down must not be recorded as an outcome ---');
// The alarm fires every scanInterval minutes all night. Writing the stand-down
// to lastCycle erased the real result six times an hour.
const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const branch = bg.slice(bg.indexOf("if (trigger === 'schedule' && !withinActiveHours(config))"));
const body = branch.slice(0, branch.indexOf('\n    }') + 6);
check('stand-down does NOT call recordCycle', !body.includes('recordCycle('), true);
check('stand-down writes its own key', body.includes('lastStandDown'), true);
check('it still explains the window', /activeHoursText\(config\)/.test(body), true);
check('the popup is sent lastStandDown', /lastStandDown,/.test(bg), true);
check('shown only while actually outside the window', /!withinActiveHours\(config\) \? sdStored : null/.test(bg), true);

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
