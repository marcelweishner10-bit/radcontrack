// Builds a local Postgres replica of production from repo migrations and a JSON backup.
// Usage: node scripts/local-replica.mjs <backup.json> <db name> [last migration prefix] [psql path] [port]
// The backup comes from the dashboard export described in migration-backup/baseline-*.md.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [backupPath, db, last = '20261008122952', psql = 'psql', port = '54329'] = process.argv.slice(2);
if (!backupPath || !db) throw new Error('Usage: node scripts/local-replica.mjs <backup.json> <db name> [last migration] [psql] [port]');
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const run = (database, args) => execFileSync(psql, ['-h', 'localhost', '-p', port, '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const tmp = mkdtempSync(join(tmpdir(), 'tracstoc-'));
const file = (name, sql) => { const path = join(tmp, name); writeFileSync(path, sql); return path; };
const literal = value => '$json$' + JSON.stringify(value) + '$json$';

run('postgres', ['-c', `drop database if exists "${db}"`, '-c', `create database "${db}"`]);
const users = backup.tables['auth.users(subset)'];
run(db, ['-f', file('bootstrap.sql', `
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
insert into auth.users(id,email,email_confirmed_at,created_at)
 select id,email,email_confirmed_at,created_at from jsonb_populate_recordset(null::auth.users, ${literal(users)}::jsonb);
`)]);

const dir = 'supabase/migrations';
for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (name.slice(0, 14) > last) continue;
  run(db, ['-f', join(dir, name)]);
}

// Replace migration seed rows with production rows, preserving every column value.
const tables = Object.keys(backup.tables).filter(t => !t.startsWith('auth.'));
let load = 'begin;\nset local session_replication_role = replica;\n';
for (const t of tables) load += `delete from ${t};\n`;
for (const t of tables) {
  if (backup.tables[t].length) load += `insert into ${t} select * from jsonb_populate_recordset(null::${t}, ${literal(backup.tables[t])}::jsonb);\n`;
}
load += 'commit;\n';
run(db, ['-f', file('load.sql', load)]);
console.log(`Loaded ${tables.length} tables into ${db} (migrations through ${last}).`);
