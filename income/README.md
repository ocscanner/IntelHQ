# Income (P08)

IntelHQ → 💼 Business → 💵 Income, or full screen at `income/`.

Owner income in one place: X payouts (ad revenue share, subscriptions), X Money, Ko-fi, Venmo,
Fourthwall merch, sponsorships, other. Totals, change vs the previous period, revenue by month,
by source, by where it was paid, X payout periods (per-day average), CSV import and export, backups.

## Where the data lives
**Only in the browser that entered it** (localStorage key `ocs-income-v1`). IntelHQ is public until
P05, so there is no server copy anyone could reach. The page's Content-Security-Policy has
`connect-src 'none'`: it cannot send anything anywhere.

- Each address is its own storage: `ocscanner.github.io/IntelHQ`, the `intelhq` Worker address and,
  later, `hq.ocscanner.media` each keep separate data. Move data with **Download backup** → **Restore**.
- Clearing site data for the address erases it. Keep backups.
- At P05 the plan is to move this into the hq database behind the owner-only login.

## Rules
- Every entry has a kind: revenue, expense, tax or transfer. **Only revenue is counted.** Expenses,
  taxes and transfers (e.g. Venmo → bank) are kept for the record and shown separately.
- Amounts are whole cents. Net = what arrived; if only gross and fees are given, net = gross − fees.
- CSV import never reads payer names or messages; a sponsor name is kept only for sponsorships.
- Text that looks like an account or card number (9+ digits) is refused.
- Imports skip rows already saved (transaction ID, or date + amounts), skip pending/failed rows, and
  can be undone as a batch. Our own CSV export imports back exactly.
- Exported CSV cells starting with = + - @ are prefixed with ' so spreadsheets don't run them.
- Every add, edit, delete, import, undo, export, backup and restore is written to History.

## Files
| File | What |
|---|---|
| `income-core.js` | All the math and CSV handling (no page code), tested |
| `app.js` | The page |
| `index.html` | Layout and styles |
| `theme.js` | Light/dark before first paint |
| `test/income-core.test.js` | `node --test income/test/*.test.js` (also runs on GitHub: "Income tests") |

## Deploy and roll back
Goes live with IntelHQ when the branch is merged to `main` (GitHub Pages and the `intelhq` Worker).
No Worker, database, secret or Cloudflare setting is involved. Roll back with `git revert` of the
merge; saved income on each device is untouched by a rollback (and comes back if it's re-merged).

## X analytics (Nov 21, 2026)
Income → **X analytics**. Pairs X's account analytics with the X payouts in Income to learn what a payout is
worth per 1,000 **verified** views, then shows this period's pace, a per-payout goal, the 90-day
eligibility count, and which posting habits get more verified views. Math in `x-core.js`, page in `x-app.js`.

- Import: x.com/i/account_analytics → Overview → Export, once with the Verified filter on and once off.
  The importer reads X's columns (Date, Impressions, … Create Post, Video views, Media views) and detects
  the Verified file (file name, or blank video/media columns); the dialog lets you correct it.
- Stored on this device (`ocs-xanalytics-v1`) and included in the Income backup file.
- Payout windows: Revenue Sharing entries carry their period. Original Content Rewards entries only have a
  pay date, so the window is the 14 days ending `lag` days before it (default 8, the best fit to the
  Sep–Nov 2026 payouts; changeable in Settings).
- Rate = median $ per 1,000 verified views over the last N complete payouts (default 6). Estimates only:
  X pays on unique Premium Home-timeline views of original posts, which the export doesn't separate out.
- Never commit real analytics exports to this public repo; tests use made-up data.
