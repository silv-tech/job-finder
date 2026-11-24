// A dead session must be caught before the cycle does any work, and must not
// spam a notification every ten minutes.
//   node scripts/login-precheck-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const MARKERS = eval(bg.match(/const SIGNED_OUT_MARKERS = (\/[^\n]+\/i);/)[1]);

let bad = 0;
const check = (l, c, e='') => { if (!c) bad++; console.log(` ${c?'OK  ':'FAIL'}  ${l}${e?'  '+e:''}`); };

console.log('--- the login page must be recognised ---');
// verbatim from the live page
check('the jobseeker login wall', MARKERS.test('Please login or register as jobseeker to apply for this job.'));
check('a login form by field name', MARKERS.test('<input type="password" name="password" class="form-control">'));
check('a login form by field id', MARKERS.test('<input id="password" type="password">'));

console.log('\n--- a signed-in job list must NOT look signed out ---');
for (const html of [
  '<div class="jobpost">Senior Automation Engineer</div><p data-temp="2026-11-24 09:00:00">Posted on</p>',
  'How it Works Messages 0 JOB BOARD PAYMENTS Account SEARCH Filter by skills',
  'Apply for this job. We need someone to register new clients in our CRM.',
]) check(`not flagged: ${JSON.stringify(html.slice(0,46))}`, !MARKERS.test(html));

console.log('\n--- ordering: checked before any work ---');
const fn = bg.slice(bg.indexOf('async function runAutoApplyCycle'));
const body = fn.slice(0, fn.indexOf('\n}\n'));
const iCheck = body.indexOf('await isBoardSignedIn()');
const iBudget = body.indexOf('budgetAllows(');
const iLane = body.indexOf('nextLaneAndSearch(');
check('login check exists in the cycle', iCheck > -1);
check('runs before the budget check', iCheck > -1 && iBudget > iCheck, `check@${iCheck} budget@${iBudget}`);
check('runs before a lane is even chosen', iCheck > -1 && iLane > iCheck, `lane@${iLane}`);

console.log('\n--- a network problem is not a logout ---');
check('null means "cannot tell"', /return null; \/\/ can't tell: a network problem is not a logout/.test(bg));
check('only an explicit false stops the cycle', /if \(signedIn === false\) \{/.test(bg));
check('and only an explicit true clears it', /if \(signedIn === true\) await noteSignedIn\(\);/.test(bg));

console.log('\n--- badge and notification behaviour ---');
check('badge turns red', /setBadgeBackgroundColor\(\{ color: '#b91c1c' \}\)/.test(bg));
check('badge clears on sign-in', /showSignedOutBadge\(false\)/.test(bg));
check('notifies on the transition only', /if \(signedOutSince\) return;/.test(bg));
check('remembers since when', /signedOutSince: new Date\(\)\.toISOString\(\)/.test(bg));
check('forgets once signed back in', /chrome\.storage\.local\.remove\('signedOutSince'\)/.test(bg));
check('a badge failure never throws', /catch \{ \/\* badge is cosmetic/.test(bg));

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
