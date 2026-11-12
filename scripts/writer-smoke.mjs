// Writes ONE real application with the shipped writer and the live profile
// defaults, then reports what the built-in quality guards say about it.
//
//   node scripts/writer-smoke.mjs
//
// Costs roughly $0.10. Proves the resume actually reaches the prompt.
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1); }

const LIB = new URL('../src/lib/', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'jf-smoke-'));
for (const mod of ['prompt-safety', 'roles', 'post-asks', 'schedule', 'verbatim', 'ai-config', 'cost-meter']) {
  writeFileSync(join(dir, mod + '.ts'),
    readFileSync(new URL(mod + '.ts', LIB), 'utf8').replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.ts'"));
}
writeFileSync(join(dir, 'writer.ts'),
  readFileSync(new URL('application-writer.ts', LIB), 'utf8')
    .replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.ts'")
    .replace("import Anthropic from '@anthropic-ai/sdk';", 'type Anthropic = any;')
    .replace('public status = 500', 'status = 500'));
const W = await import(pathToFileURL(join(dir, 'writer.ts')).href);

// Pull the REAL shipped defaults rather than retyping them.
const profileSrc = readFileSync(new URL('profile.ts', LIB), 'utf8');
const pick = (k) => (profileSrc.match(new RegExp(`\\n  ${k}: '((?:[^'\\\\]|\\\\.)*)'`)) || [,''])[1].replace(/\\'/g, "'");
const resume_text = JSON.parse((profileSrc.match(/\n  resume_text: ("(?:[^"\\]|\\.)*"),/) || [,'""'])[1]);
const PROFILE = {
  name: pick('name'), email: pick('email'),
  headline: pick('headline'), bio: pick('bio'),
  portfolio_url: pick('portfolio_url'), linkedin_url: pick('linkedin_url'),
  skills: (profileSrc.match(/\n  skills: \[([\s\S]*?)\],\n/) || [,''])[1]
    .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean),
  resume_text,
  role_highlights: null,
};
console.log(`profile: resume_text = ${resume_text.length} chars, skills = ${PROFILE.skills.length}`);
console.log(`headline: ${PROFILE.headline}\n`);

const JOB = {
  title: 'Automation Specialist (Make.com / n8n) for a growing agency',
  company: '',
  skills: ['Make.com', 'n8n', 'APIs', 'Airtable'],
  description: `We run a small marketing agency and our ops are held together by manual work.
We need someone to build and maintain automations between our tools.

What you'll do:
- Build workflows in Make.com or n8n connecting forms, Airtable and Slack
- Fix automations when they break, and tell us WHY they broke
- Document what you build so the team can follow it

Must be available 9am-1pm EST for overlap.

In your reply please answer these:
1. Tell us about a time an automation you built broke in production. What did you do?
2. Which tools have you actually used, and for how long?
3. Why this role?

Start your message with the word BANANA so we know you read this.`,
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000, maxRetries: 1 });
const meter = W.newCostMeter();
const t0 = Date.now();
const tick = setInterval(() => console.error(`  ...${Math.round((Date.now()-t0)/1000)}s`), 15000);
const out = await W.writeApplication(client, JOB, PROFILE, { role: 'automations', meter,
  onProgress: (p) => console.error('  [' + Math.round((Date.now()-t0)/1000) + 's] ' + p) });
clearInterval(tick);

console.log('='.repeat(72));
console.log('SUBJECT:', out.subject, `(${out.subject.length} chars)`);
console.log('='.repeat(72));
console.log(out.cover_letter);
console.log('='.repeat(72));
console.log('hidden instruction found :', out.hidden_instructions_found || 'none');
console.log('AI tells                 :', W.findAiTells(out.cover_letter, out.subject).join('; ') || 'none');
console.log('weak subject             :', W.weakSubject(out.subject, PROFILE.name, JOB.title).join('; ') || 'none');
console.log('named employers          :', W.namedEmployers(out.cover_letter).join('; ') || 'none');
console.log('false tool claims        :', W.falseToolClaims(W.lackingTools(JOB, PROFILE), out.cover_letter).join('; ') || 'none');
console.log('starts with BANANA       :', /^banana/i.test(out.cover_letter.trim()) ? 'yes' : 'NO');
console.log('answers 3 questions      :', out.cover_letter.split(/\n\n/).length, 'paragraphs,', out.cover_letter.split(/\s+/).length, 'words');
console.log('cost                     : $' + meter.usd.toFixed(4), `(${meter.calls} calls)`);
