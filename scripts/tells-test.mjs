// Guards the AI-tell patterns against both misses and false positives.
//   node scripts/tells-test.mjs    (free, no API calls)
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const LIB = new URL('./src/lib/', pathToFileURL(process.cwd()+'/'));
const dir = mkdtempSync(join(tmpdir(),'jf-t-'));
for (const m of ['prompt-safety','roles','post-asks','schedule','verbatim','ai-config','cost-meter'])
  writeFileSync(join(dir,m+'.ts'), readFileSync(new URL(m+'.ts',LIB),'utf8').replace(/from '@\/lib\/([\w-]+)'/g,"from './$1.ts'"));
writeFileSync(join(dir,'w.ts'), readFileSync(new URL('application-writer.ts',LIB),'utf8')
  .replace(/from '@\/lib\/([\w-]+)'/g,"from './$1.ts'")
  .replace("import Anthropic from '@anthropic-ai/sdk';",'type Anthropic = any;')
  .replace('public status = 500','status = 500'));
const { findAiTells } = await import(pathToFileURL(join(dir,'w.ts')).href);

const SHOULD_FLAG = [
  "I believe I would be a great addition to your team.",
  "I think I could help with that.",
  "I'm fairly confident I can handle the workload.",
  "If given the chance, I will prove myself.",
  "I hope to hear back from you soon.",
  "I may not have used Airtable, but I learn fast.",
  "I would be a good fit for this role.",
];
const SHOULD_NOT_FLAG = [
  "I built a restock alerting system that watches 30+ retailers.",
  "I ran a team of 30+ and grew monthly net sales from $40,000 to $200,000.",
  "I think the Airtable side is where most of these break.",   // opinion about THEIR setup
  "I believe the forms are the bottleneck here.",              // opinion, not self-hedge
  "I hope that helps.",
  "9am-1pm EST lands at 10pm-2am my time, and that is the day I will work.",
  "I can start Monday.",
];
let bad = 0;
console.log("--- should be flagged ---");
for (const t of SHOULD_FLAG) {
  const f = findAiTells(t); const ok = f.length > 0; if (!ok) bad++;
  console.log(` ${ok?'OK  ':'MISS'}  ${JSON.stringify(t.slice(0,52))} ${f[0]?'-> '+f[0]:''}`);
}
console.log("--- should NOT be flagged ---");
for (const t of SHOULD_NOT_FLAG) {
  const f = findAiTells(t); const ok = f.length === 0; if (!ok) bad++;
  console.log(` ${ok?'OK  ':'FALSE POSITIVE'}  ${JSON.stringify(t.slice(0,52))} ${f.join('; ')}`);
}
console.log(bad === 0 ? "\nall clean" : `\n${bad} PROBLEM(S)`);
