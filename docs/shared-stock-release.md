# Shared stock release (October 2026)

## What changes for staff
- Films, CDs, sleeves, gloves, connectors and Gastrolux come from one **Shared stock** pool. Usage is still recorded against the room, date and shift where it happened.
- CT and MRI contrast stay room stock. A pick sends each item to its own location: MRI contrast to MRI, CT contrast to CT (or Fluoroscopy when picked for Fluoroscopy), everything else to Shared stock. The room the stock was picked for is kept.
- The daily table keeps its layout. Shared items also show "Used in other rooms this shift" and how much of a pickup was collected for this room.
- **Finish shift** needs every item reviewed (amount used, or None used). It no longer asks for a physical count. Physical counts are recorded under **Stock → Stock check**, where a count replaces the balance; it does not add stock.
- A saved shift is flagged as changed only when something dated up to that shift changes. Later days, and other rooms' usage, no longer flag it.
- Honey can move a contrast pick to the room it actually went to (Movement history → Edit / delete → Move to correct room).

## Database changes, in order
1. `20261015200000_correct_pick_room.sql`: **already applied on 15 Oct 2026**.
2. `20261008135954_shared_consumable_stock.sql` (PR #29). This moves existing consumable balances and movements into Shared stock and records the original room in `usage_room` and in the audit history.
3. `20261015210000_shared_stock_followup.sql`: must run directly after step 2. It restores per-modality item lists, adds per-item pick routing, `stock_movements.picked_for`, other-room usage and the review-only finish, narrows the review token and refreshes it for unaffected saved shifts, and revokes unused table privileges.

Apply steps 2 and 3 back to back, then publish the app straight away. The old app keeps working against the new database in between (same function signatures), but it still asks for counts to finish a shift.

## Checks before and after
- Take a fresh backup (JSON export of all Tracstoc tables) and record the counts and checksums (`scripts/replica-checksums.sql`).
- Afterwards:
  - Row counts of `daily_contrast_data`, `stock_shift_usage`, `room_stock_movements` and `stock_movements` are unchanged.
  - Department + all locations total per item is unchanged.
  - Every location balance equals the sum of its movements.
  - Contrast rows are untouched.

## Local testing
- `node scripts/local-replica.mjs <backup.json> <db> 20261015200000 <psql>` rebuilds production on a local Postgres.
- `scripts/shared-stock-followup-tests.sql` runs the end-to-end checks on that replica:
  - preservation, routing, top-ups, cross-room use, corrections, wastage;
  - token behaviour, finishing, day permissions, counts.
- `scripts/local-supabase-load.mjs` loads the replica into a local Supabase stack. `npm run dev -- --mode localdb` then previews the app against it, with logins in the git-ignored `.env.localdb.local`.

## Rollback
The consolidation is not reversed automatically. Every moved row has an audit record with its original room (`before_record`), and the pre-release JSON backup holds the earlier state. To roll back the app only, republish the previous Cloudflare deployment. The new database stays compatible with it.

## Release record, 16 Oct 2026 (~05:30 WAT)
- Pre-release backup: `migration-backup/tracstoc-backup-2026-10-16-prerelease.json` (git-ignored), SHA-256 da500a8a…, verified after download. Rehearsed on a replica of that backup; all end-to-end checks passed.
- Database: `20261008135954` and `20261015210000` applied in one transaction through the SQL editor, with in-transaction checks on per-item totals, ledgers, row counts and usage/contrast checksums. The checks passed and the transaction committed. The 7 changed function bodies match the repo.
- After release: per-item totals are identical to before (for example CD 579, 17 × 14 film 850, CT contrast 4494 ml). Contrast rooms are unchanged (CT 1419 ml, MRI 7 ml). The Shared pool holds 8 items; 75 earlier picks are attributed to rooms; the clinical record checksum is unchanged; TRUNCATE/TRIGGER/REFERENCES grants are removed.
- App: Cloudflare Pages deployment `3d1a7469` (wrangler direct upload of commit 4bd50f7), bundle `index-X7elfRs1.js`, now served at https://tracstoc.pages.dev. Previous production deployment for an app-only rollback: `0dec7ca0`.
