// The apply path: dead posts, and picking the right "apply" control.
// Text here is taken verbatim from a real onlinejobs.ph page.
//   node scripts/apply-button-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../extension/content-scripts/onlinejobs.js', import.meta.url), 'utf8');

const DEAD = src.match(/(\/job unavailable[\s\S]*?\/i)\.test\(bodyText\)/)[1];
const deadRe = eval(DEAD);
const NOT_APPLY = eval(src.match(/const NOT_APPLY = (\/[^\n]+\/i);/)[1]);

let bad = 0;
const check = (label, cond, extra = '') => { if (!cond) bad++; console.log(` ${cond ? 'OK  ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

console.log('--- dead posts must be caught before anything is filled ---');
const REAL = 'How it Works Pricing Real Results POST A JOB FIND JOBS LOG IN SIGN UP Job Unavailable This job post is no longer visible because the account has been deactivated or banned. For more opportunities, visit our Job Search';
check('the exact live page that failed today', deadRe.test(REAL));
for (const t of [
  'Job Unavailable',
  'This job post is no longer visible because the account has been deactivated or banned.',
  'This job has been closed by the employer',
  'This job post has been filled',
  'Sorry, this job is no longer available.',
  'This account has been removed',
]) check(`caught: ${JSON.stringify(t.slice(0, 52))}`, deadRe.test(t));

console.log('\n--- a healthy post must NOT look dead ---');
for (const t of [
  'Apply for this job. We are hiring a developer, full time, start immediately.',
  'We need someone available long term. No longer accepting phone calls, email only.',
  'Send your resume and portfolio. This role is open until filled.',
]) check(`not flagged: ${JSON.stringify(t.slice(0, 52))}`, !deadRe.test(t), deadRe.test(t) ? 'FALSE POSITIVE' : '');

console.log('\n--- the matcher must skip these "apply" decoys ---');
for (const t of ['Apply Points', 'apply points: 2', 'How to apply', 'Apply filters', 'Reapply', 'FAQ'])
  check(`rejected: ${JSON.stringify(t)}`, NOT_APPLY.test(t));

console.log('\n--- and must NOT reject the real control ---');
for (const t of ['Apply', 'Apply Now', 'Apply for this job', 'APPLY TO THIS JOB'])
  check(`kept: ${JSON.stringify(t)}`, !NOT_APPLY.test(t), NOT_APPLY.test(t) ? 'WRONGLY REJECTED' : '');

console.log('\n--- scoring prefers the real control over a decoy ---');
const score = (raw, tag = 'A') => {
  const text = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!text.includes('apply') || text.includes('applied')) return 0;
  if (NOT_APPLY.test(text)) return 0;
  let s = 1;
  if (/^apply( now| for this job| to this job| for this position)?$/.test(text)) s = 10;
  else if (/^apply\b/.test(text)) s = 6;
  if (text.length > 40) s -= 2;
  if (tag === 'BUTTON' || tag === 'INPUT') s += 1;
  return s;
};
check('"Apply for this job" beats a long paragraph', score('Apply for this job') > score('You can apply for this job by sending your resume to us today'));
check('"Apply Now" beats "Apply Points"', score('Apply Now') > score('Apply Points'));
check('"Apply Points" scores zero', score('Apply Points') === 0);
check('"How to apply" scores zero', score('How to apply') === 0);
check('a real button outscores the same text as a link', score('Apply', 'BUTTON') > score('Apply', 'A'));

console.log('\n--- the burn fix: both lists must be cleared on a failure ---');
const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const fail = bg.slice(bg.indexOf("outcomes.push('fill failed: '"), bg.indexOf("outcomes.push('fill failed: '") + 600);
check('clears appliedUrls (the list applyToJobs filters on)', fail.includes('unmarkApplied('));
check('clears seenUrls too', fail.includes('unmarkSeen('));
check('an UNKNOWN outcome is still left marked', bg.includes("outcomes.push('no reply after send')") && !bg.slice(bg.indexOf("'no reply after send'") - 300, bg.indexOf("'no reply after send'")).includes('unmarkApplied'));

console.log('\n--- the button must be WAITED for, not read once ---');
const cs = src;
check('there is a wait helper', /async function waitForApplyButton\(timeoutMs = \d+\)/.test(cs));
check('it retries until a deadline', /while \(!btn && Date\.now\(\) < deadline\)/.test(cs));
check('the handler awaits it', /let applyBtn = await waitForApplyButton\(\);/.test(cs));
check('the finder is separate so it can be retried', /function findApplyButton\(\)/.test(cs));
check('no single-pass scan left in the handler',
  !/const allButtons = document\.querySelectorAll\('a, button, input\[type="submit"\]'\);/.test(cs));

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
