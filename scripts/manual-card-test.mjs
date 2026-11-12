// The "Needs you" card is where parked Loom jobs are reviewed. Runs the real
// paintManual() from popup.js against stubs.
//   node scripts/manual-card-test.mjs   (free, no API calls)
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
const start = src.indexOf("    let manualPainted = '';");
const endMark = "          });\n        });\n      });\n    }\n";
const end = src.indexOf(endMark, start) + endMark.length;
if (start < 0 || end <= start) { console.error('could not extract paintManual'); process.exit(1); }
const body = src.slice(start, end);

let queue = [];
const els = {};
const mkEl = () => ({
  innerHTML: '', textContent: '', classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, has(c){return this._s.has(c);} },
  _handlers: [],
  querySelectorAll(sel) {
    // Parse each <button ...> tag properly instead of one clever regex: the
    // optional-group version silently matched zero-width and reported every
    // data-what as undefined.
    const cls = sel.replace('.', '');
    const out = [];
    for (const tag of this.innerHTML.match(/<button[^>]*>/g) || []) {
      if (!tag.includes(`class="${cls}"`)) continue;
      const attr = (n) => (tag.match(new RegExp(`${n}="([^"]*)"`)) || [, undefined])[1];
      out.push({
        textContent: cls === 'manual-copy' ? 'Copy' : 'Done',
        dataset: { i: attr('data-i'), what: attr('data-what'), url: attr('data-url') },
        addEventListener(_e, fn) { this._fn = fn; },
      });
    }
    return out;
  },
});
for (const id of ['manual-card', 'manual-list', 'manual-count']) els[id] = mkEl();

let paints = 0;
const ctx = {
  chrome: { runtime: { sendMessage: (msg, cb) => { if (msg.action === 'getManualQueue') cb(queue); else cb({ ok: true }); } } },
  document: { getElementById: (id) => els[id] || null },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout: () => {},
  esc: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
};
const fn = new Function(...Object.keys(ctx), `${body}
  return { paintManual, peek: () => manualPainted };`);
const wrapped = fn(...Object.values(ctx));
const origInner = Object.getOwnPropertyDescriptor(els['manual-list'], 'innerHTML');
let lastHtml = '';
Object.defineProperty(els['manual-list'], 'innerHTML', {
  get: () => lastHtml,
  set: (v) => { lastHtml = v; paints++; },
});
void origInner;

let bad = 0;
const check = (label, cond, extra = '') => { if (!cond) bad++; console.log(` ${cond ? 'OK  ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

const JOB = {
  apply_url: 'https://www.onlinejobs.ph/jobseekers/job/1234',
  title: 'Automation Engineer',
  score: 88,
  requirements: ['Loom video required'],
  subject: '10PM to 2AM my time, covers your 9-1 EST',
  message: 'BANANA\n\nYour hours work for me...',
};

console.log('--- empty queue ---');
queue = []; wrapped.paintManual();
check('card hidden when nothing is parked', els['manual-card'].classList.has('hidden'));

console.log('\n--- one parked Loom job ---');
queue = [JOB]; wrapped.paintManual();
const html = lastHtml;
check('card is shown', !els['manual-card'].classList.has('hidden'));
check('count shows (1)', els['manual-count'].textContent === '(1)', els['manual-count'].textContent);
check('job title rendered', html.includes('Automation Engineer'));
check('requirement rendered', html.includes('Loom video required'));
check('SUBJECT LABEL present (the bug)', /Subject<\/div>/.test(html));
check('subject TEXT present (the bug)', html.includes('10PM to 2AM my time'));
check('a copy-subject button exists', /data-what="subject"/.test(html));
check('a copy-message button exists', /data-what="message"/.test(html));
check('apply_url is linked', html.includes(JOB.apply_url));

console.log('\n--- the copy buttons return the right half ---');
const btns = els['manual-list'].querySelectorAll('.manual-copy');
check('two copy buttons found', btns.length === 2, `got ${btns.length}`);
check('first targets subject', btns[0]?.dataset.what === 'subject');
check('second targets message', btns[1]?.dataset.what === 'message');
check('index points at the right item', btns.every((b) => queue[Number(b.dataset.i)] === JOB));

console.log('\n--- the 10s repaint must not destroy the DOM ---');
const before = paints; wrapped.paintManual(); wrapped.paintManual();
check('unchanged queue does not repaint', paints === before, `paints ${before} -> ${paints}`);
queue = [{ ...JOB, subject: 'a different subject' }]; wrapped.paintManual();
check('a changed queue DOES repaint', paints === before + 1);
check('new subject is on screen', lastHtml.includes('a different subject'));

console.log('\n--- a job whose draft failed ---');
queue = [{ ...JOB, subject: '', message: '' }]; wrapped.paintManual();
check('no copy buttons when there is nothing to copy', !/data-what=/.test(lastHtml));
check('still listed so it is not lost', lastHtml.includes('Automation Engineer'));

console.log('\n--- a malformed reply must not throw ---');
for (const weird of [null, undefined, { error: 'boom' }, 'nope']) {
  queue = weird;
  try { wrapped.paintManual(); check(`survives ${JSON.stringify(weird)}`, true); }
  catch (e) { check(`survives ${JSON.stringify(weird)}`, false, e.message); }
}

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
