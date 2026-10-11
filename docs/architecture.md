# Architecture

One app, one kind of thing: a **Project**. A project is either **Group** (trip, event, team) or
**Personal** (your own money book). There is no company/corporate type.

```
apps/mobile   Expo (React Native) app: Android, iOS and web from one codebase
apps/server   Sync server (Hono + SQLite). Runs on Node; portable to Cloudflare Workers
packages/core All money rules and the sync engine, shared by app and server (pure TypeScript)
docs/         Specs, this file, screenshots
```

## How data is stored and synced (offline-first)

Every change (add expense, approve member, record payment, …) is an **operation** with a unique
id created on the phone.

1. The phone applies it immediately and saves it in its local database (SQLite on phones,
   browser storage on web). The user never waits for the network.
2. In the background, queued operations are sent to the server. The server checks the rules
   (permissions, amounts adding up, project not archived, …) and gives each accepted
   operation the next number in that project's log: 1, 2, 3, … with no gaps.
3. Phones download the log and rebuild the project state from it in that exact order, so
   every phone ends with the same numbers.

Why there are no double or missing entries:

| Risk | Protection |
|---|---|
| Same change sent twice (retry, lost reply, crash) | The operation id is the idempotency key. The server records it once and answers "duplicate" afterwards. |
| Change lost before it reached the server | It stays in the phone's queue (saved to disk before the UI says "saved") until the phone sees it in the server log. |
| Phone misses part of the log | Pages must be continuous (seq 1..n). A page with a gap is refused and downloaded again. |
| Two people edit at once | Only the creator edits an entry, admins override as a new version, and every version is kept. Balances are always recalculated from entries, never stored as running totals. |
| Server refuses a change made offline | It moves to a "refused" list with the reason, shown to the user. It is never silently dropped. |

This is verified by a randomized simulation (`packages/core/test/sync.test.ts`). Four phones make
random changes while the network drops requests, loses replies, delivers twice, and apps crash.
After the network heals, every phone must match the server exactly, with no duplicates, no
losses and identical balances. It runs 120 random scenarios on every test run.

## Money rules

- Amounts are whole **paisa** (integers). ৳2,400.50 is stored as 240050, never as a float.
- Splits (equal, exact, %, shares) use largest-remainder rounding. Parts always add up to the
  total exactly; leftover paisa go to members in join order, so every phone gets the same result.
- Net balance = paid − share + payments/contributions given − received. The nets of a project
  always add up to exactly 0, and the dashboard shows a "Books balanced" check.
- Suggested payments: fewest transfers (at most members − 1) that clear every balance.
- Group cost = more than half of active members benefit (auto, switchable). The budget measures
  group costs only. Personal costs are visible only to the people involved; the server sends
  everyone else just the balance effect.

## Accounts

The phone creates its own account id and secret on first launch, so it works offline from the
first second. The first time it reaches the server, the id is registered and bound to that
secret (nobody else can claim it). The backup file contains the account, so a new phone restored
from a backup is the same person. Google sign-in will be added for recovery without a file.

## Where to host the database, and is it free?

Short answer: **nothing is free at large scale forever, but this design keeps costs close to
zero for a long time.**

- Each phone holds its own data. The server only stores operation logs, which are tiny
  (a trip with 500 entries is roughly 250 KB).
- Personal projects don't need the server at all except for multi-phone sync, and they can be
  backed up to the user's own Google Drive, which is the user's free storage, not yours.
- Photos are never stored on our server. The gallery uses the user's Telegram group, and receipts
  are compressed.

Recommended path:

| Stage | Host | Cost |
|---|---|---|
| Development / first users | Any small VPS or a free container host running `apps/server` (Node + SQLite file) | Free–$5/month |
| Growth | **Cloudflare Workers + Durable Objects (SQLite)**: one Durable Object per project matches this design exactly (one ordered log per project). Workers Free includes SQLite-backed Durable Objects. | Free tier, then ~$5/month Workers Paid |
| Alternative | Supabase / Neon Postgres | Free tiers exist but are small (Supabase free: 500 MB, pauses after a week idle), so they are fine for testing, not for production |

Free tiers and limits change. Check the current pricing pages before launch.

## What is not built yet

- Google sign-in and automatic Google Drive backup. A backup file works today and can be saved
  to Drive manually.
- Telegram gallery (see the group spec, Appendix A).
- Receipt photos.
- Push notifications (balance-change notifications are computed by `balanceChangeAudience`
  but not delivered yet).
- Personal-project accounts (cash/bKash/bank), transfers, recurring items and savings goals
  from the personal spec.
- The web version does not yet work offline after a page reload (needs a service worker).
  The phone apps are not affected.
