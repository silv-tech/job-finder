// A job must be judged on the lane it fits, not the lane that found it.
//   node scripts/lane-scoring-test.mjs   (free, no API calls)
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'jf-lane-'));
for (const m of ['lanes', 'roles', 'prompt-safety', 'verbatim', 'post-asks', 'schedule', 'ai-config', 'cost-meter']) {
  try {
    writeFileSync(join(dir, m + '.ts'),
      readFileSync(new URL(`../src/lib/${m}.ts`, import.meta.url), 'utf8')
        .replace(/from '@\/lib\/([\w-]+)'/g, "from './$1.ts'")
        .replace("import Anthropic from '@anthropic-ai/sdk';", 'type Anthropic = any;'));
  } catch {}
}
const { scoreForLane, bestLane } = await import(pathToFileURL(join(dir, 'lanes.ts')).href);

let bad = 0;
const check = (l, c, e='') => { if (!c) bad++; console.log(` ${c?'OK  ':'FAIL'}  ${l}${e?'  '+e:''}`); };

// A real automation post, the kind surfaced by a developer-term search.
const AUTOMATION_JOB = {
  title: 'AI Automation Specialist (Make.com / n8n)',
  description: `We need someone to build and maintain automations between our tools.
Build workflows in Make.com or n8n connecting forms, Airtable and Slack.
Fix automations when they break. Document what you build. Zapier experience a plus.
Experience with APIs and AI tools required.`,
};

const asDeveloper = scoreForLane(AUTOMATION_JOB, 'developer').score;
const best = bestLane(AUTOMATION_JOB);

console.log('--- the same job, judged two ways ---');
console.log(`   scored against the DEVELOPER lane : ${asDeveloper}`);
console.log(`   scored against its BEST lane      : ${best.score}  (${best.lane})`);
check('best lane is automations', best.lane === 'automations');
check('judging it as a developer job scores it lower', best.score > asDeveloper,
  `${best.score} vs ${asDeveloper}`);
check('as a developer job it misses the bar of 60', asDeveloper < 60, `got ${asDeveloper}`);
check('on its own lane it clears the bar', best.score >= 60, `got ${best.score}`);

console.log('\n--- the route must use bestLane, unconditionally ---');
const route = readFileSync(new URL('../src/app/api/extension/match-jobs/route.ts', import.meta.url), 'utf8');
check('scores with bestLane', /const scored = bestLane\(job\);/.test(route));
check('no longer scores against the requested lane',
  !/laneKey \? scoreForLane\(job, laneKey\)/.test(route));
check('threshold follows the matched lane', /explicitMin \?\? LANES\[scored\.lane\]\.minScore/.test(route));
check('an explicit min_score still wins', /typeof min_score === 'number' \? min_score : null/.test(route));

console.log('\n--- a genuine developer job still scores as one ---');
const DEV_JOB = {
  title: 'Full Stack Web Developer (React / Node)',
  description: 'Build and maintain our web app. React, Node.js, PostgreSQL, REST APIs. Deploy and debug production issues.',
};
const db = bestLane(DEV_JOB);
check('best lane is developer', db.lane === 'developer', db.lane);
check('clears the bar', db.score >= 60, `got ${db.score}`);

console.log(bad === 0 ? '\nall clean' : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
