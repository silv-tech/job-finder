// What a fresh install actually does: the config it seeds, and which posts are
// held back for him instead of sent.
//   node scripts/automation-config-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const cfg = eval('(' + bg.match(/const DEFAULT_CONFIG = (\{[\s\S]*?\n\});/)[1] + ')');

let bad = 0;
const want = (label, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) bad++;
  console.log(` ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(46)} ${JSON.stringify(got)}${ok ? '' : '  want ' + JSON.stringify(expected)}`);
};

console.log('--- what a fresh install seeds (onInstalled -> DEFAULT_CONFIG) ---');
want('finds jobs without being told to', cfg.autoApply, true);
want('sends without per-job approval', cfg.reviewBeforeSend, false);
want('starts at 08:00 local', cfg.activeStartHour, 8);
want('stops at 22:00 local', cfg.activeEndHour, 22);
want('scan every N minutes', cfg.scanInterval, 10);
want('daily Apply Point budget', cfg.dailyApBudget, 10);
want('server is production', cfg.apiUrl, 'https://jobs.dlvasolutions.com');
want('lanes cover what he asked for',
  cfg.lanes, ['developer','automations','management','exec_assistant','general_va']);

console.log('\n--- Apply Points: 2 for a strong match, 1 for a marginal one ---');
const apForScore = (s) => (s >= 70 ? 2 : 1);
for (const [score, pts] of [[95,2],[70,2],[69,1],[60,1]]) want(`score ${score} costs`, apForScore(score), pts);
const strong = Math.floor(cfg.dailyApBudget / 2), weak = cfg.dailyApBudget;
console.log(`        -> ${strong} applications/day if all strong, ${weak} if all marginal`);
want('lands inside his 5-10 a day', strong >= 5 && weak <= 10, true);
want('spends exactly the 10/day refill, no drain', cfg.dailyApBudget, 10);

console.log('\n--- posts that must NEVER auto-send (drafted and parked instead) ---');
const TRIGGERS = [...readFileSync(new URL('../src/lib/manual-requirements.ts', import.meta.url), 'utf8')
  .matchAll(/\{ pattern: (\/[^/]+\/i), label: '([^']+)' \}/g)].map(m => [eval(m[1]), m[2]]);
const detect = (d) => TRIGGERS.filter(([re]) => re.test(d)).map(([, l]) => l);
const HOLD = [
  'Please send a Loom video introducing yourself.',
  'Record a video telling us why you want this role.',
  'We require a short video introduction with your application.',
  'Include a screen recording of your process.',
  'There is a short code test before we interview.',
  'Candidates will complete a technical assessment.',
  'We start with a paid test project.',
  'First step is a Zoom call with the founder.',
  'We will set up a Google Meet to discuss.',
  'This role begins with a trial task.',
];
for (const d of HOLD) {
  const r = detect(d);
  const ok = r.length > 0; if (!ok) bad++;
  console.log(` ${ok ? 'HELD' : 'FAIL'}  ${JSON.stringify(d.slice(0, 50))} ${r[0] ? '-> ' + r[0] : ''}`);
}
console.log('\n--- ordinary posts that SHOULD auto-send ---');
const SEND = [
  'Send your resume and tell us about your experience with Zapier.',
  'Apply with a short message about relevant projects you have built.',
  'We need a developer for our Next.js app. Include your portfolio.',
  'Tell us your availability and rate.',
];
for (const d of SEND) {
  const r = detect(d);
  const ok = r.length === 0; if (!ok) bad++;
  console.log(` ${ok ? 'SEND' : 'FALSE HOLD'}  ${JSON.stringify(d.slice(0, 50))} ${r.join('; ')}`);
}
console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
