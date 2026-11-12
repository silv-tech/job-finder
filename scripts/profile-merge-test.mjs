// The save path must never lose the resume. Covers the clobber bug and the
// URL normalisation.
//   node scripts/profile-merge-test.mjs   (free, no API calls)
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'jf-pm-'));
writeFileSync(join(dir, 'm.ts'), readFileSync(new URL('../src/lib/profile-merge.ts', import.meta.url), 'utf8'));
const { mergeProfileRow, normaliseUrl } = await import(pathToFileURL(join(dir, 'm.ts')).href);

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(` ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(56)} ${JSON.stringify(got)}${ok ? '' : '  want ' + JSON.stringify(want)}`);
};

const REAL = {
  user_id: 'u1', email: 'leif@forgeaiagent.com',
  resume_text: 'R'.repeat(7048),
  writing_samples: 'W'.repeat(2457),
  headline: 'Full-Stack Developer & Operations Leader Building AI Products',
  bio: 'real bio', skills: ['React', 'Node'],
  portfolio_url: 'dlvasolutions.com/portfolio',
  role_highlights: { developer: 'built things', _source: 'abc' },
};

console.log('--- the bug: a Save after a failed fetch must not wipe anything ---');
let r = mergeProfileRow(REAL, { name: 'Leif Soliva', resume_text: '', writing_samples: '' }, 'u1');
check('resume_text survives an empty body field', r.resume_text.length, 7048);
check('writing_samples survives', r.writing_samples.length, 2457);
check('headline survives', r.headline, REAL.headline);
check('skills survive an absent body field', r.skills, ['React', 'Node']);
check('the field that WAS sent is applied', r.name, 'Leif Soliva');

console.log('\n--- a body with nothing in it changes nothing ---');
r = mergeProfileRow(REAL, {}, 'u1');
check('resume_text untouched', r.resume_text.length, 7048);
check('writing_samples untouched', r.writing_samples.length, 2457);
check('bio untouched', r.bio, 'real bio');

console.log('\n--- real updates still land ---');
r = mergeProfileRow(REAL, { resume_text: 'a newer, longer resume', bio: 'new bio' }, 'u1');
check('resume_text updates when non-empty', r.resume_text, 'a newer, longer resume');
check('bio updates', r.bio, 'new bio');

console.log('\n--- whitespace-only is still empty ---');
r = mergeProfileRow(REAL, { resume_text: '   \n  ' }, 'u1');
check('blank-ish body does not wipe', r.resume_text.length, 7048);

console.log('\n--- a first save with no existing row ---');
r = mergeProfileRow(null, { name: 'Leif', portfolio_url: 'example.com/p' }, 'u9');
check('user_id set', r.user_id, 'u9');
check('missing fields become empty, not undefined', r.resume_text, '');
check('skills default to []', r.skills, []);

console.log('\n--- derived data never round-trips through the browser ---');
r = mergeProfileRow(REAL, { role_highlights: { developer: 'STALE' } }, 'u1');
check('role_highlights is never written from a body', r.role_highlights, undefined);

console.log('\n--- URLs get a scheme, because a bare domain is not a link ---');
for (const [input, want] of [
  ['dlvasolutions.com/portfolio', 'https://dlvasolutions.com/portfolio'],
  ['https://dlvasolutions.com/portfolio/', 'https://dlvasolutions.com/portfolio/'],
  ['http://example.com', 'http://example.com'],
  ['//cdn.example.com/x', 'https://cdn.example.com/x'],
  ['/leading/slash', 'https://leading/slash'],
  ['', ''],
]) check(`normaliseUrl(${JSON.stringify(input)})`, normaliseUrl(input), want);

r = mergeProfileRow(REAL, {}, 'u1');
check('stored bare portfolio_url is fixed on save', r.portfolio_url, 'https://dlvasolutions.com/portfolio');

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
