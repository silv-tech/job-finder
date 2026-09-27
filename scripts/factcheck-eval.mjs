// Does Sonnet 5 catch the same fabrications Opus 5 caught?
//
// The fact-check was 56% of a $0.18 application on Opus. Moving it to Sonnet is
// only a good trade if it still catches invented facts, and that is a question
// for measurement, not for an opinion about model tiers. This feeds BOTH models
// the identical prompt the app ships, using drafts whose lies are known in
// advance, and reports what each one found.
//
//   ANTHROPIC_API_KEY=... node scripts/factcheck-eval.mjs
//
// Costs roughly $0.30 for the full run. Put the key in .env.local rather than on
// the command line so it never lands in a shell history.
import { readFileSync, existsSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('No ANTHROPIC_API_KEY. Put it in .env.local as ANTHROPIC_API_KEY=sk-...');
  process.exit(1);
}

const { factCheck, newCostMeter } = await import('../src/lib/application-writer.ts');

// His real background, trimmed to what the checker is given. Everything NOT in
// here is, by definition, a fabrication if the letter asserts it.
const PROFILE = {
  name: 'Aldonn Leif Soliva',
  headline: 'Developer, automation builder and operations manager',
  bio: 'Builds web apps and automations. Has run a support team.',
  skills: ['WordPress', 'PHP', 'JavaScript', 'Claude API', 'Supabase', 'Next.js', 'Make', 'Zapier'],
  resume_text: [
    'Built DCTE and H.U.B, live storefronts from scratch: product catalogs, GCash and',
    'bank checkout, loyalty systems, trade-in estimation, customer accounts.',
    'Built ForgeAI, a Next.js platform on Claude API, Supabase and Vercel.',
    'Built WhiteLabelAI, a multi-tenant white-label chatbot platform; bots train on',
    'PDF, text or scraped URLs and connect to Facebook Messenger via the Graph API.',
    'Ran a team of 30+ and grew monthly net sales from $40,000 to $200,000.',
  ].join('\n'),
  role_highlights: { developer: 'Shipped a white-label platform end to end.' },
};
const JOB = {
  title: 'Senior Full-Stack WordPress + AI Developer',
  company: 'Acme',
  description: 'Build a WordPress platform with Gravity Forms and an LLM endpoint.',
};

// Each case: a draft, and the lies it contains. `clean` must produce NO findings.
const CASES = [
  { name: 'clean (must not false-alarm)', lies: [], letter:
    'Hi there,\n\nI built a multi-tenant white-label chatbot platform where bots train on PDF, ' +
    'text or scraped URLs, running on the Claude API with Supabase. That is the shape of work ' +
    'your LLM endpoint needs.\n\nLeif' },
  { name: 'invented employer', lies: ['Shopify'], letter:
    'Hi there,\n\nI spent three years at Shopify building checkout systems, and I built a ' +
    'white-label chatbot platform on the Claude API.\n\nLeif' },
  { name: 'inflated number', lies: ['team of 90', '$2 million'], letter:
    'Hi there,\n\nI ran a team of 90 and grew monthly net sales from $40,000 to $2 million.\n\nLeif' },
  { name: 'tool never used', lies: ['Gravity Forms'], letter:
    'Hi there,\n\nI have used Gravity Forms for four years, writing custom add-ons and merge ' +
    'tags for client sites.\n\nLeif' },
  { name: 'habit stated as fact', lies: ['every morning', 'weekly'], letter:
    'Hi there,\n\nEvery morning I triage the error queue before standup, and I send a weekly ' +
    'reliability report to stakeholders.\n\nLeif' },
  { name: 'their task claimed as done', lies: ['Gravity Forms + LLM'], letter:
    'Hi there,\n\nThe Gravity Forms to LLM pipeline you describe is exactly what I built and ' +
    'shipped for a previous client last year.\n\nLeif' },
  { name: 'subtle embellishment', lies: ['because sales were stuck'], letter:
    'Hi there,\n\nI ran a team of 30+ and grew monthly net sales from $40,000 to $200,000, ' +
    'because sales were stuck when I took over and nobody had a system.\n\nLeif' },
];

const MODELS = ['claude-opus-5', 'claude-sonnet-5'];
const results = {};

for (const model of MODELS) {
  const client = new Anthropic({ apiKey: key });
  const meter = newCostMeter();
  results[model] = { rows: [], meter };
  console.log(`\n=== ${model} ===`);
  for (const c of CASES) {
    const draft = { subject: 'Gravity Forms and a Claude endpoint', cover_letter: c.letter, fields: {}, hidden_instructions_found: null };
    let found = [];
    let verdict;
    try {
      const out = await factCheck(client, JOB, PROFILE, draft, meter, model);
      if (out === 'failed') verdict = 'CALL FAILED';
      else if (out === null) found = [];
      else found = (out.unsupported || []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    } catch (e) {
      verdict = 'THREW: ' + e.message;
    }
    const caught = c.lies.filter((lie) =>
      found.some((f) => f.toLowerCase().includes(lie.toLowerCase().split(' ')[0])));
    const ok = c.lies.length === 0 ? found.length === 0 : caught.length === c.lies.length;
    verdict = verdict || (ok ? 'PASS' : c.lies.length === 0 ? 'FALSE ALARM' : `MISSED ${c.lies.length - caught.length}/${c.lies.length}`);
    results[model].rows.push({ name: c.name, verdict, found: found.length });
    console.log(`  ${verdict.padEnd(14)} ${c.name.padEnd(34)} ${found.length} finding(s)`);
  }
  console.log(`  cost: $${results[model].meter.usd.toFixed(4)}`);
}

console.log('\n=== SIDE BY SIDE ===');
console.log('case'.padEnd(36) + MODELS.map((m) => m.replace('claude-', '').padEnd(16)).join(''));
for (let i = 0; i < CASES.length; i++) {
  console.log(
    CASES[i].name.padEnd(36) +
      MODELS.map((m) => results[m].rows[i].verdict.padEnd(16)).join('')
  );
}
console.log('');
for (const m of MODELS) {
  const passed = results[m].rows.filter((r) => r.verdict === 'PASS').length;
  console.log(`  ${m.padEnd(18)} ${passed}/${CASES.length} correct   $${results[m].meter.usd.toFixed(4)}`);
}
console.log('\nSonnet is the right call only if it matches Opus on the lie cases AND');
console.log('does not false-alarm on the clean one. Anything else, revert the one line');
console.log('in src/lib/ai-config.ts.');
