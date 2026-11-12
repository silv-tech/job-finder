// The report must never describe a parked job as sent, and must surface the
// ones waiting on him.
//   node scripts/daily-report-test.mjs   (free, no API calls)
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'jf-dr-'));
writeFileSync(join(dir, 'r.ts'), readFileSync(new URL('../src/lib/daily-report.ts', import.meta.url), 'utf8'));
const R = await import(pathToFileURL(join(dir, 'r.ts')).href);

let bad = 0;
const check = (label, cond, extra = '') => { if (!cond) bad++; console.log(` ${cond ? 'OK  ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

const sent = (o) => ({ title: 'Sent job', score: 80, lane: 'developer', apply_points: 2, subject: 'a real subject', message: 'the letter', status: 'sent', sent_at: '2026-11-13T02:00:00Z', ...o });
const parked = (o) => ({ title: 'Loom job', score: 90, lane: 'automations', apply_points: 0, subject: 'Needs you: Loom video required', message: 'drafted letter', status: 'needs_manual', sent_at: '2026-11-13T03:00:00Z', ...o });

console.log('--- the bug: parked jobs were counted as sent ---');
let subj = R.reportSubject([sent(), sent(), parked()], '2026-11-13');
check('counts only what actually went out', subj.includes('2 applications sent'), subj);
check('still mentions what is waiting', subj.includes('1 waiting on you'), subj);
check('best match ignores the parked one', subj.includes('80%'), subj);

subj = R.reportSubject([parked(), parked()], '2026-11-13');
check('nothing sent, 2 waiting', subj === 'Job Finder: nothing sent 2026-11-13, 2 waiting on you', subj);
subj = R.reportSubject([], '2026-11-13');
check('a genuinely empty day', subj === 'Job Finder: nothing sent 2026-11-13', subj);
subj = R.reportSubject([sent()], '2026-11-13');
check('no waiting clause when there is none', !subj.includes('waiting'), subj);

console.log('\n--- the parked section ---');
let html = R.reportHtml([sent(), parked()], '2026-11-13', 6);
check('says how many are waiting', html.includes('1 job waiting on you'));
check('names the parked job', html.includes('Loom job'));
check('points him at the popup', html.includes('Needs you'));
check('shows the drafted subject to reuse', html.includes('Needs you: Loom video required'));
check('does NOT claim the parked one was sent', !/Loom job[\s\S]{0,400}Message sent/.test(html));
check('the sent one still has its message', html.includes('the letter'));

console.log('\n--- a day where everything needs him ---');
html = R.reportHtml([parked(), parked()], '2026-11-13', 10);
check('still reports no applications went out', html.includes('No applications went out today'));
check('but surfaces both parked jobs', html.includes('2 jobs waiting on you'));

console.log('\n--- points and lanes ---');
html = R.reportHtml([sent({ apply_points: 2 }), parked({ apply_points: 0 })], '2026-11-13', 8);
check('parked jobs do not inflate the points spent', /2\s*(?:apply )?point/.test(html));
check('the automations lane has a label now', html.includes('Automations'));
check('no raw lane key leaks through', !/>automations</.test(html));

console.log('\n--- rows with no status (older rows) count as sent ---');
subj = R.reportSubject([{ title: 'legacy', score: 70 }], '2026-11-13');
check('a missing status is treated as sent', subj.includes('1 application sent'), subj);

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
