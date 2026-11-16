// Only posts that are genuinely minutes old. Timestamps below are the real
// format the board emits: data-temp="2026-11-17 03:53:00", PHT, to the second.
//   node scripts/freshness-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const grab = (n) => bg.match(new RegExp(`function ${n}\\([\\s\\S]*?\\n\\}`))[0];
const { jobAgeHours, filterFresh } = new Function(`${grab('jobAgeHours')} ${grab('filterFresh')}
  return { jobAgeHours, filterFresh };`)();

let bad = 0;
const check = (l, c, e='') => { if (!c) bad++; console.log(` ${c?'OK  ':'FAIL'}  ${l}${e?'  '+e:''}`); };

// Pin "now" to a known PHT instant so the test cannot drift.
const NOW = Date.UTC(2026, 10, 17, 4, 0, 0) - 8*3600*1000; // 2026-11-17 04:00 PHT
const realNow = Date.now;
Date.now = () => NOW;
const post = (s) => ({ apply_url: 'u'+s, posted_at: s });

console.log('--- age, measured in PHT regardless of machine timezone ---');
for (const [stamp, hrs] of [
  ['2026-11-17 03:53:00', 7/60],
  ['2026-11-17 03:30:00', 0.5],
  ['2026-11-17 03:00:00', 1],
  ['2026-11-17 02:00:00', 2],
  ['2026-11-16 04:00:00', 24],
]) check(`${stamp} -> ${hrs.toFixed(2)}h`, Math.abs(jobAgeHours(stamp) - hrs) < 0.01, `got ${jobAgeHours(stamp).toFixed(3)}`);

console.log('\n--- the 1 hour rule: what he wants applied to ---');
const jobs = [
  post('2026-11-17 03:55:00'), // 5 min
  post('2026-11-17 03:50:00'), // 10 min
  post('2026-11-17 03:30:00'), // 30 min
  post('2026-11-17 03:00:00'), // exactly 1h
  post('2026-11-17 02:30:00'), // 1.5h  - skip
  post('2026-11-16 16:00:00'), // 12h   - skip
  post('2026-11-16 04:00:00'), // 24h   - skip
];
const kept = filterFresh(jobs, 1, true).map(j => j.posted_at);
check('5 minutes old  -> applied', kept.includes('2026-11-17 03:55:00'));
check('10 minutes old -> applied', kept.includes('2026-11-17 03:50:00'));
check('30 minutes old -> applied', kept.includes('2026-11-17 03:30:00'));
check('exactly 1 hour -> applied', kept.includes('2026-11-17 03:00:00'));
check('1.5 hours old  -> SKIPPED', !kept.includes('2026-11-17 02:30:00'));
check('12 hours old   -> SKIPPED', !kept.includes('2026-11-16 16:00:00'));
check('a day old      -> SKIPPED', !kept.includes('2026-11-16 04:00:00'));
check('exactly 4 kept', kept.length === 4, `got ${kept.length}`);

console.log('\n--- a post with no timestamp ---');
const undated = [{ apply_url: 'x', posted_at: '' }];
check('skipped when the window is an hour', filterFresh(undated, 1, true).length === 0);
check('kept when told to keep it', filterFresh(undated, 1, false).length === 1);

console.log('\n--- config plumbing ---');
check('default is 1 hour', /maxJobAgeHours: 1,/.test(bg));
check('undated skipped by default', /skipUndatedPosts: true,/.test(bg));
check('the caller passes the flag', /filterFresh\(unseen, maxAge, skipUndated\)/.test(bg));
check('migration only moves the exact old default', /config\.maxJobAgeHours !== OLD_DEFAULT_JOB_AGE_HOURS\) return;/.test(bg));
check('migration runs at worker start', /migrateFreshnessPolicy\(\);/.test(bg));
check('migration cannot break startup', /migrateFreshnessPolicy[\s\S]{0,700}catch \(err\)/.test(bg));

Date.now = realNow;
console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
