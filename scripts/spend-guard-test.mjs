// Nothing should be paid for that cannot be sent, and no post should be paid
// for twice. Free: no API calls.
//   node scripts/spend-guard-test.mjs
import { readFileSync } from 'node:fs';
const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const cs = readFileSync(new URL('../extension/content-scripts/onlinejobs.js', import.meta.url), 'utf8');

let bad = 0;
const check = (label, cond, extra = '') => { if (!cond) bad++; console.log(` ${cond ? 'OK  ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

console.log('--- the pre-flight runs BEFORE the model is called ---');
const fn = cs.slice(cs.indexOf('async function handleAutoFillAndSend'), cs.indexOf('async function handleAutoFillAndSend') + 2200);
const iGuard = fn.indexOf('messageTargets().length');
const iPay = fn.indexOf("action: 'generateApplication'");
check('guard exists', iGuard > -1);
check('guard precedes the paid call', iGuard > -1 && iPay > -1 && iGuard < iPay, `guard@${iGuard} pay@${iPay}`);
check('it returns without paying', /messageTargets\(\)\.length\)\s*\{[\s\S]{0,140}return \{ success: false/.test(fn));

console.log('\n--- the spend check and the fill use ONE definition ---');
check('messageTargets is defined once', (cs.match(/function messageTargets\(/g) || []).length === 1);
check('the fill fallback uses it', /const candidates = messageTargets\(\);/.test(cs));
check('no second hand-rolled textarea filter left behind',
  (cs.match(/querySelectorAll\('textarea'\)\]\.filter/g) || []).length === 1);

console.log('\n--- the retry memo ---');
const memo = bg.slice(bg.indexOf('const draftMemo'), bg.indexOf('function recordGeneration'));
check('memo is time-bounded', /DRAFT_MEMO_MS/.test(bg) && /Date\.now\(\) - hit\.at > DRAFT_MEMO_MS/.test(memo));
check('memo is size-bounded', /draftMemo\.size > 50/.test(memo));
check('keyed by apply_url', /draftMemo\.set\(url/.test(memo));
const handler = bg.slice(bg.indexOf("message.action === 'generateApplication'"), bg.indexOf("message.action === 'saveJob'"));
check('a rework still pays (not served from memo)', /const rework = !!\(message\.options/.test(handler) && /!rework && takeDraftMemo/.test(handler));
check('a failed generation is NOT memoised', /if \(!res \|\| res\.error\)[\s\S]{0,80}sendResponse\(res\);[\s\S]{0,30}return;/.test(handler));
check('memo hit short-circuits before handleGenerateApplication',
  handler.indexOf('takeDraftMemo') < handler.indexOf('await handleGenerateApplication'));

console.log('\n--- the log that replaces guessing ---');
check('every generation is logged', /logGeneration\(url, rework \? 'rework' : 'fresh'/.test(handler));
check('memo hits are logged too', /logGeneration\(url, 'memo-hit'/.test(handler));
check('log records kind and outcome', /\{ at: new Date\(\)\.toISOString\(\), url: url \|\| '', kind, outcome \}/.test(bg));
check('log is capped', /genLog\.slice\(0, 200\)/.test(bg));
check('logging can never break a generation', /\}\)\.catch\(\(\) => \{\}\);/.test(bg.slice(bg.indexOf('function logGeneration'), bg.indexOf('function recordGeneration'))));

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
