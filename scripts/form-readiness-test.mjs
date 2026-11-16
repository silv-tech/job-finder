// The apply form is "ready" only when a box the letter can go in is VISIBLE.
// The two hidden textareas below are the real ones found on a live
// onlinejobs.ph job page on 2026-11-17, before the apply form exists.
//   node scripts/form-readiness-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../extension/content-scripts/onlinejobs.js', import.meta.url), 'utf8');
const body = src.match(/function messageTargets\(\)[\s\S]*?\n  \}/)[0];

const mk = (o) => ({
  disabled: false, readOnly: false, offsetParent: {}, clientWidth: 600, clientHeight: 200,
  name: '', placeholder: '', id: '', closest: () => null, ...o,
});
let DOM = [];
const ctx = {
  document: {
    querySelectorAll: () => DOM,
    querySelector: () => null,
  },
  attrSelector: (a, v) => `[${a}="${v}"]`,
};
const messageTargets = new Function(...Object.keys(ctx), `${body}; return messageTargets;`)(...Object.values(ctx));

let bad = 0;
const check = (label, cond, extra='') => { if (!cond) bad++; console.log(` ${cond?'OK  ':'FAIL'}  ${label}${extra?'  '+extra:''}`); };

// Verbatim from the live page
const BOOKMARK_NOTE = mk({ name: 'note', id: 'noteText', offsetParent: null, clientWidth: 0, clientHeight: 0 });
const REPORT_BOX    = mk({ placeholder: 'Kindly elaborate more on the reason here', offsetParent: null, clientWidth: 0, clientHeight: 0 });
const REAL_MESSAGE  = mk({ name: 'message', clientWidth: 700, clientHeight: 300 });
const CONTACT_BOX   = mk({ name: 'contact_info', clientWidth: 500, clientHeight: 90 });

console.log('--- the live job page BEFORE the apply form renders ---');
DOM = [BOOKMARK_NOTE, REPORT_BOX];
check('the Bookmark and Report popups are not a message box', messageTargets().length === 0,
  `got ${messageTargets().length}`);
check('so the page is NOT reported ready', !(messageTargets().length > 0));

console.log('\n--- once the real apply form renders ---');
DOM = [BOOKMARK_NOTE, REPORT_BOX, REAL_MESSAGE];
check('the real box is found', messageTargets().length === 1);
check('and it is the right one', messageTargets()[0] === REAL_MESSAGE);

console.log('\n--- a form with a contact box too ---');
DOM = [BOOKMARK_NOTE, CONTACT_BOX, REAL_MESSAGE];
check('contact box is excluded', !messageTargets().includes(CONTACT_BOX));
check('biggest visible box wins', messageTargets()[0] === REAL_MESSAGE);

console.log('\n--- things that must never be treated as writable ---');
for (const [label, el] of [
  ['disabled', mk({ disabled: true })],
  ['readOnly', mk({ readOnly: true })],
  ['display:none', mk({ offsetParent: null })],
]) { DOM = [el]; check(label + ' is rejected', messageTargets().length === 0); }

console.log('\n--- every readiness gate uses it, none trust a bare textarea ---');
check('hasTextarea uses messageTargets', /hasTextarea: messageTargets\(\)\.length > 0/.test(src));
check('waitForFormFields uses it', /messageTargets\(\)\.length === 0\)/.test(src));
check('no gate left on querySelector(\'textarea\')',
  !/!document\.querySelector\('textarea'\)/.test(src) && !/!!document\.querySelector\('textarea'\)/.test(src));

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
