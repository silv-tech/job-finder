// Is a cheaper draft still a good letter?
//
// The draft is now 46% of an application and about 2,850 of its ~3,450 output
// tokens are reasoning nobody reads. Lowering its effort is the biggest saving
// left — but unlike the fact-check, there is no right answer to test against:
// the draft IS the product. So this generates the SAME application twice, once
// at each effort, and prints both letters and both prices side by side for a
// human to judge.
//
//   railway run --service job-finder -- node scripts/draft-effort-ab.mjs
//
// Costs roughly two applications.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('No ANTHROPIC_API_KEY (run through `railway run`).'); process.exit(1); }

const LIB = new URL('../src/lib/', import.meta.url);

// The module reads DRAFT_EFFORT at import time, so each arm gets its own copy.
async function loadWriter(effort) {
  const dir = mkdtempSync(join(tmpdir(), `jf-ab-${effort}-`));
  for (const m of ['prompt-safety', 'roles', 'post-asks', 'schedule', 'verbatim', 'cost-meter']) {
    writeFileSync(join(dir, m + '.ts'),
      readFileSync(new URL(m + '.ts', LIB), 'utf8').replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.ts'"));
  }
  writeFileSync(join(dir, 'ai-config.ts'),
    readFileSync(new URL('ai-config.ts', LIB), 'utf8')
      .replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.ts'")
      // Pin the effort into the copy rather than relying on env ordering.
      .replace(/export const DRAFT_EFFORT =[\s\S]*?as 'low' \| 'medium' \| 'high';/,
               `export const DRAFT_EFFORT = '${effort}' as 'low' | 'medium' | 'high';`));
  writeFileSync(join(dir, 'writer.ts'),
    readFileSync(new URL('application-writer.ts', LIB), 'utf8')
      .replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.ts'")
      .replace("import Anthropic from '@anthropic-ai/sdk';", 'type Anthropic = any;')
      .replace('public status = 500', 'status = 500'));
  return import(pathToFileURL(join(dir, 'writer.ts')).href);
}

const PROFILE = {
  name: 'Aldonn Leif Soliva', email: 'solivaaldon@gmail.com', phone: '+639628631952',
  headline: 'Developer, automation builder and operations manager',
  bio: 'Builds web apps, storefronts and AI automations end to end.',
  skills: ['WordPress', 'PHP', 'JavaScript', 'Next.js', 'Express', 'Supabase', 'Claude API', 'Make', 'Zapier'],
  resume_text: [
    'Built WhiteLabelAI, a multi-tenant white-label chatbot platform for agencies:',
    'bots train on PDF, text or scraped URLs, embeddable widgets, Facebook Messenger',
    'via the Graph API, JWT auth keeping each agency separate, Next.js + Express +',
    'Supabase, deployed on Railway.',
    'Built ForgeAI (forgeaiagent.com), a Next.js platform on Claude API and Supabase',
    'that scrapes prospect sites and generates demo pages and outreach emails.',
    'Built DCTE (dctestore.com) and H.U.B (hanapusapbuild.store), live storefronts',
    'hand-coded without templates: product catalogs, GCash and bank checkout,',
    'loyalty rewards, trade-in estimation, customer accounts.',
    'Ran a team of 30+ and grew monthly net sales from $40,000 to $200,000.',
  ].join('\n'),
  portfolio_url: 'https://dlvasolutions.com/portfolio',
  linkedin_url: 'https://www.linkedin.com/in/aldonn-leif-soliva',
  role_highlights: { developer: 'Shipped a multi-tenant white-label platform end to end.' },
  writing_samples: 'Hi Ana, the tricky part here is keeping the two systems in step.',
};

const JOB = {
  title: 'Senior Full-Stack WordPress & AI Developer',
  company: 'ProWeb365',
  skills: ['WordPress', 'Gravity Forms', 'Elementor', 'Claude API'],
  description: readFileSync(new URL('../.ab-job.txt', import.meta.url), 'utf8'),
};

for (const effort of ['medium', 'low']) {
  const W = await loadWriter(effort);
  const meter = W.newCostMeter();
  const t0 = Date.now();
  let out;
  try {
    out = await W.writeApplication(new Anthropic({ apiKey: key }), JOB, PROFILE,
      { role: 'developer', formFields: [], meter });
  } catch (e) {
    console.log(`\n===== DRAFT EFFORT: ${effort} =====\nFAILED: ${e.message}`);
    continue;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`DRAFT EFFORT: ${effort.toUpperCase()}   $${out.cost.usd}   ${out.cost.calls} calls   ${out.cost.out} output tokens   ${secs}s`);
  console.log('='.repeat(74));
  console.log(`SUBJECT: ${out.subject}\n`);
  console.log(out.cover_letter);
}
