// Loads a production replica into a local Supabase stack for previewing the app.
// Usage: node scripts/local-supabase-load.mjs <replica db> <bin dir with psql/pg_dump> <supabase status env file>
// The replica database comes from scripts/local-replica.mjs on the portable Postgres (port 54329).
// Writes .env.localdb.local (git-ignored) with the local API URL, anon key and generated test logins.
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [replica, bin, statusFile] = process.argv.slice(2);
if (!replica || !bin || !statusFile) throw new Error('Usage: node scripts/local-supabase-load.mjs <replica db> <bin dir> <status env file>');
const status = Object.fromEntries(readFileSync(statusFile, 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
}));
const api = status.API_URL, anon = status.ANON_KEY, service = status.SERVICE_ROLE_KEY;
if (!api?.startsWith('http://127.0.0.1') && !api?.startsWith('http://localhost')) throw new Error(`Refusing non-local API URL: ${api}`);
const exe = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const tmp = mkdtempSync(join(tmpdir(), 'tracstoc-stack-'));
const stack = ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'];
const env = { ...process.env, PGPASSWORD: 'postgres' };
const psql = (...args) => execFileSync(exe('psql'), [...stack, ...args], { env, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const replicaSql = sql => execFileSync(exe('psql'), ['-h', 'localhost', '-p', '54329', '-U', 'postgres', '-d', replica, '-tA', '-c', sql]).toString().trim();

// 1. Local-only logins with the production user IDs, so recorded_by and audit references resolve.
const users = JSON.parse(replicaSql(`select json_agg(json_build_object('id',id,'email',email)) from auth.users`));
const logins = [];
for (const user of users) {
  const password = 'local-' + randomBytes(9).toString('base64url');
  const response = await fetch(`${api}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: user.id, email: user.email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`Creating ${user.email}: ${response.status} ${await response.text()}`);
  logins.push(`# ${user.email} / ${password}`);
}

// 2. Schema as in production today, then the replica's rows (including the 15 Oct corrections).
const dir = 'supabase/migrations';
const migrations = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
for (const name of migrations.filter(n => n.slice(0, 14) <= '20261015200000' && !n.startsWith('20261008135954'))) psql('-f', join(dir, name));
const dump = join(tmp, 'data.sql');
execFileSync(exe('pg_dump'), ['-h', 'localhost', '-p', '54329', '-U', 'postgres', '-d', replica, '--data-only', '--no-owner',
  '-n', 'public', '-n', 'radcontrack_private', '-f', dump]);
const tables = replicaSql(`select string_agg(format('%I.%I',schemaname,tablename),',') from pg_tables where schemaname in ('public','radcontrack_private')`);
writeFileSync(join(tmp, 'load.sql'), `begin;\nset session_replication_role = replica;\ntruncate ${tables};\n\\i ${dump.replace(/\\/g, '/')}\ncommit;\n`);
psql('-f', join(tmp, 'load.sql'));

// 3. The release under preview.
psql('-f', join(dir, '20261008135954_shared_consumable_stock.sql'));
psql('-f', join(dir, '20261015210000_shared_stock_followup.sql'));

writeFileSync('.env.localdb.local', [
  '# Local preview only (npm run dev -- --mode localdb). Never used by production builds.',
  `VITE_SUPABASE_URL="${api}"`, `VITE_SUPABASE_PUBLISHABLE_KEY="${anon}"`, 'VITE_SUPABASE_PROJECT_ID="tracstoc-local"',
  '# Test logins for this local stack only:', ...logins, '',
].join('\n'));
console.log(`Loaded ${replica} into the local stack; ${logins.length} local logins written to .env.localdb.local`);
