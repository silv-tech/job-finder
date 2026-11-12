// Repairs the stored profile row in place. Deliberately narrow: it adds a
// missing scheme to link fields and nothing else.
//
// An earlier version of this script also pushed resume_text and
// writing_samples from DEFAULT_PROFILE, which would have replaced 7048
// characters of real resume with a 3429-character summary. It now refuses to
// shorten either field under any circumstances.
//
//   node scripts/fix-profile-urls.mjs           # report only
//   node scripts/fix-profile-urls.mjs --write   # apply
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Missing Supabase URL or service key in .env.local'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const dir = mkdtempSync(join(tmpdir(), 'jf-u-'));
writeFileSync(join(dir, 'm.ts'), readFileSync(new URL('../src/lib/profile-merge.ts', import.meta.url), 'utf8'));
const { normaliseUrl } = await import(pathToFileURL(join(dir, 'm.ts')).href);

const rows = await fetch(`${url}/rest/v1/profiles?select=user_id,email,portfolio_url,linkedin_url,upwork_url,resume_url,resume_text,writing_samples`, { headers: H }).then(r => r.json());
if (!Array.isArray(rows) || rows.length !== 1) {
  console.error(Array.isArray(rows) ? `Expected 1 profile row, found ${rows.length}. Refusing to guess.` : `Unexpected response: ${JSON.stringify(rows).slice(0, 200)}`);
  process.exit(1);
}
const row = rows[0];
console.log(`profile: ${row.email}`);
console.log(`  resume_text     : ${row.resume_text?.length || 0} chars  (not touched by this script)`);
console.log(`  writing_samples : ${row.writing_samples?.length || 0} chars  (not touched by this script)`);

const patch = {};
for (const k of ['portfolio_url', 'linkedin_url', 'upwork_url', 'resume_url']) {
  const cur = row[k] || '';
  if (!cur) continue;
  const fixed = normaliseUrl(cur);
  console.log(`  ${k.padEnd(16)}: ${cur}${fixed !== cur ? `   ->   ${fixed}` : '   (already fine)'}`);
  if (fixed !== cur) patch[k] = fixed;
}
if (!Object.keys(patch).length) { console.log('\nNothing to fix.'); process.exit(0); }
if (!process.argv.includes('--write')) { console.log('\n(report only; pass --write to apply)'); process.exit(0); }

const res = await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(row.user_id)}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
});
if (!res.ok) { console.error('PATCH failed:', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
const [after] = await res.json();
console.log('\nwritten:');
for (const k of Object.keys(patch)) console.log(`  ${k.padEnd(16)}: ${after[k]}`);
console.log(`  resume_text     : ${after.resume_text?.length || 0} chars (unchanged)`);
console.log(`  writing_samples : ${after.writing_samples?.length || 0} chars (unchanged)`);
