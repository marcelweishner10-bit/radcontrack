// Isolated copy only. Never accepts a production URL or database name.
import {execFileSync} from 'node:child_process';
const psql='../postgres-test-tools/pgsql/bin/psql.exe';
const tests=process.argv[2]||'scripts/daily-close-tests.sql';
execFileSync(process.execPath,['scripts/local-replica.mjs','migration-backup/tracstoc-backup-2026-10-16-prerelease.json','daily_close_workflow_qa','20261008122952',psql,'54329'],{stdio:'inherit'});
execFileSync(psql,['-h','localhost','-p','54329','-U','postgres','-d','daily_close_workflow_qa','-v','ON_ERROR_STOP=1','-q',
 '-f','supabase/migrations/20261008135954_shared_consumable_stock.sql',
 '-f','supabase/migrations/20261015200000_correct_pick_room.sql',
 '-f','supabase/migrations/20261015210000_shared_stock_followup.sql',
 '-f',tests],{stdio:'inherit'});
