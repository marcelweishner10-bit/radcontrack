# Daily close workflow

Released to the live database and Cloudflare Pages on 2 November 2026.

Production backup: ignored `deployment-artifacts/daily-close-2026-11-02/production-before.csv` (JSON export inside CSV). The guarded transaction returned PRESERVED for all 13 original public/private tables, including 243 clinical days, 123 shift reviews, 240 shift usage records, 356 department movements, 427 room movements and 921 correction audit records. All original reviews retained legacy mode; no daily records were fabricated. RLS enabled, direct authenticated insert and anonymous execution denied. Existing staff login successfully loaded the new context and yesterday's original MRI record.

Final live check caught PostgreSQL's null composite represented as an object of null fields. The client now normalizes an absent close to null so an untouched day cannot claim to be saved. Regression test passed. No data changes are needed for this display correction.

## Staff workflow

- Contrast per shift: room, shift, patients, administered ml and wastage. No daily rounding changes physical consumption.
- Daily close: night personnel confirm films (including reprints) and required patients per room and film size, plus CDs/sleeves and connectors/syringes for all rooms. A blank patient count blocks closing the day. None/no activity explicitly records zero films and zero patients; progress can be saved unfinished.
- Mammography does not print: new daily closes exclude its film fields. Any earlier recorded Mammography film quantities remain accessible and unchanged.
- Packs and bottles: optional whole quantities finished. Electrode weekly observations go in the handover note; do not count strips or set the balance to unopened packs alone. Displayed existing stock units are retained.
- Markers, pens, A4: receive/pick history records issues. They are outside daily consumption.
- Pickups and within-shift top-ups keep using the existing audited stock movement workflow.

## Preservation and calculations

Migration `20261102052458_daily_close_workflow.sql` is additive. It does not update/delete historical receipts, usage, clinical records, stock movements or balances. It adds `entry_mode` (existing rows default to `legacy`) and a separate `daily_stock_closes` table.

Earlier reviews keep their existing screen and original writer. New contrast records use a contrast-only writer. Films/other consumables are not created by this writer. Contrast status ignores unrelated film/CD movements.

Daily target minus earlier shift usage = additional daily deduction. Corrections change only the difference from the last additional deduction. Earlier stock usage rows remain untouched. Attempts to enter below earlier recorded usage are rejected. Once a daily total covers an item, a conflicting original shift quantity change is blocked; contrast-only changes remain allowed.

Reports combine original shift usage and additional daily deductions exactly once. Whole-day film targets also take precedence over earlier browser-only film values. Unrecorded daily patient breakdowns remain unknown.

Names, before/after daily records, reasons and authenticated actors are retained in the existing audit archive. Direct table writes are denied; RPCs enforce inventory access and the existing today/yesterday/Honey date rules. Physical count boundaries remain protected. Stock tokens prevent saving against stale pickups or corrections.

## Release order

1. Take a fresh production backup. Compare migration history: the existing Shared stock follow-up must already be installed.
2. Apply only the new migration, not old migrations again.
3. Verify original-table row counts/hashes and stock totals before/after. The only old-row shape change is `entry_mode='legacy'` on review rows.
4. Deploy the frontend once as a bundled release. Verify a real login can read the new context; do not submit test usage into production.

Do not deploy the frontend before the database migration: daily close and its reports depend on the new table and RPCs.

## Verification

Action feedback is persistent beside the viewport across daily close, unified shift, stock receipt/pick/count/correction/access and earlier room usage forms. Pending actions disable repeat submissions; slow requests explain the wait. Confirmed writes are distinguished from subsequent refresh failures. Stock background refresh no longer clears action errors. Clinical auto-save now reports pending/saving/saved/error and warns before leaving an unconfirmed save. No live data or database schema was changed for this feedback work.

`node scripts/daily-close-qa.mjs` rebuilds an isolated portable-Postgres copy from the saved October backup. It validates the migration leaves seven historical datasets identical, then tests differential deductions, repeat saves, upward/downward corrections, preservation of earlier shift rows, contrast-only completion, audit records, table grants, anonymous denial and past-date restrictions. Test changes roll back.

`npm test`, TypeScript checking and the production build cover the client. No additional runtime package was added.
