# Group Project: Feature Spec (v1 final draft)

A Group Project is a shared ledger for a trip, event, class project, household or any team. Each member records their own spending, and everyone sees one accurate combined picture. The app is **offline-first**: everything works without a network.

---

## 1. Project life cycle

| State | How it gets there | What members can do |
|---|---|---|
| Active | Default | Everything |
| Archived | Admin archives it, or **auto-archived after 3 months without updates** | View current state and **download data** only |
| Trash | Admin deletes it | Same as archived. **Permanently deleted after 30 days** |

- Archived projects appear under a separate **Archive** button.
- Only the creator or an admin can archive, delete or restore.
- Name is the only required field when creating a project. Optional: description, cover photo, dates, currency, total budget, WhatsApp group link, Telegram group link.

## 2. Screen layout (tabs)

1. **Dashboard**: totals, budget, charts, balances, settle-up
2. **Expenses**: the entry list and add-expense button
3. **Members**: member list, profiles, join requests (admin)
4. **Gallery**: shared trip photos and videos (section 11)

## 3. Members, roles and joining

- The creator is the first admin. Admins can promote other members to admin.
- Join via link, QR code or code. A new person (including a guest) goes to a **pending list**. Admin approves or rejects.
- After joining, the member sees the project's **WhatsApp and Telegram group links** (if set). They stay visible in project info.
- **Admin leaves:** other admins continue. If none exist, the earliest-joined member becomes admin.
- **Leaving:**
  - A member with unsettled balance needs admin approval to leave.
  - A settled member leaves freely.
- **Rejoining:**
  - A member who left voluntarily is **re-joined automatically** with their old membership and can again edit and delete the entries they created.
  - A member **removed by an admin** needs admin approval to return.
- Membership is tied to the person's account (phone/email login), not the device.
- **Member profile** (each member edits their own): name, WhatsApp, bKash, address, NID, bank account and similar. **None are mandatory.**

## 4. Adding an expense

Fields:
- **Amount**, with a **built-in calculator** (+, −, ×, ÷, parentheses, %). The result is shown before saving.
- **Category** (see below)
- **Date** (default today)
- **Note**
- **Receipt photo** (optional)
- **Who paid:** pick from the member list. Multiple payers are allowed, and each payer's amount is entered.
- **Who benefited:** pick from the member list.

**Split methods**, available separately for payers and for beneficiaries:
- Equal (default)
- Exact amounts
- Percentages
- Shares (for example 2 and 1)

Members can add expenses on behalf of others.

**Expense list item shows:** amount, category, date, note, who paid, a Group/Personal tag, and a sync status mark.

**Categories**
- Default set: Food, Groceries, Transport, Fuel, Accommodation, Tickets & Entry, Shopping, Medical, Tips, Other.
- Admin can add, rename and hide categories.

## 5. Group cost vs. personal cost

- An expense is automatically tagged **Group** when **more than half of the active members** are beneficiaries. Otherwise it is tagged **Personal**.
- The tag is applied silently (no prompt per entry). Tapping the tag on the item switches it.
- **Group total** = sum of full amounts of all Group-tagged expenses.
- **Personal total (per person)** = sum of that person's share in Personal-tagged expenses plus their payments on them.
- Group-tagged expenses are visible to all members. Personal-tagged expenses are visible **only to the payers and beneficiaries involved**.

## 6. Accounting rules (the books)

All numbers follow strict rules:
1. Money is stored in the smallest unit (paisa) as whole numbers. No decimals or floating point.
2. For every expense: **payer amounts add up to the total**, and **beneficiary shares add up to the total**. The app refuses to save otherwise.
3. Rounding: leftover paisa from splits go to members in a fixed, published order (join order), so every phone computes the same result.
4. **Net balance of a member** = (total they paid) − (total share they owe), across Group and Personal costs, ± settlements and contributions.
5. The sum of all members' net balances is always **exactly zero**. The dashboard shows a "books balanced" check.
6. Entries are never overwritten. Edits and deletes create new versions, and balances are always recalculated from entries.

**Worked example**
- Hotel 12,000 paid by A (8,000) and B (4,000), shared equally by A, B, C, D, so each owes 3,000. This is Group.
- C buys a gift for 1,000 and splits it with D, so each owes 500. This is Personal.

| Member | Paid | Owes | Net |
|---|---|---|---|
| A | 8,000 | 3,000 | +5,000 |
| B | 4,000 | 3,000 | +1,000 |
| C | 1,000 | 3,500 | −2,500 |
| D | 0 | 3,500 | −3,500 |
| Total | | | 0 |

Simplified payments: C pays A 2,500. D pays A 2,500 and B 1,000.
Group total is 12,000 (the 1,000 gift is excluded).

## 7. Settlement

- **Simplified debts:** the app suggests the minimum number of payments, and shows the group part and personal part of each balance.
- **Record a payment:** amount, method (cash, bKash, bank, etc.), optional proof photo. Partial payments are allowed. The receiver confirms or disputes it.
- **Contribution transfer:** a member gives money to one **or several** members at once as part of their contribution to the project, recorded as one entry with an amount per recipient. Each recipient confirms their part. It changes balances the same way a payment does, and is labelled "Contribution".
- **WhatsApp message generator:** a ready-to-send reminder, for example "Rafi, you owe Sara 1,200 for Cox's Bazar trip".

## 8. Budget and dashboard

- The admin sets a total budget and optional category budgets.
- **Budget spent = Group total** (full amounts of Group-tagged expenses). Personal-tagged expenses are excluded.
- **Remaining = Budget − Group total.**
- The budget is a **soft limit**: it can be exceeded, shown with a warning, and nothing is blocked.
- The dashboard is visible to everyone. It shows Group total vs. budget, spending by category, by day and by member (Group costs only), each member's own personal total, and settlement status.
- Each member sees the breakdown of **their own** costs. Nobody sees another member's personal breakdown.

## 9. Editing, history and restore

- A member can edit or delete **only their own entries**.
- **Admins can override** any entry. The original is kept in history, the entry is marked "overridden by admin", and the creator is notified.
- Every edit or delete is stored as a version. The **entry's creator and admins** can view history and restore any version or deleted entry.
- If an edit, delete or override **changes anyone's balance**, a notification goes to the entry's creator, the admins and the affected members.
- Members can flag an entry ("this isn't mine").

## 10. Activity feed and notifications

- **Feed shows:** expenses added/edited/deleted, settlements, contributions, gallery uploads.
- **Feed does not show:** joining, leaving, approvals.
- **Notifications:** join requests (admin), leave requests (admin), expenses involving you, settlement and contribution requests, balance-changing edits/deletes, budget warnings.

## 11. Trip gallery (Telegram storage)

- Members can upload photos and videos in the Gallery tab.
- Media is sent to the project's linked **Telegram group** by a project bot. The gallery shows previews and full view.
- Uploads made offline are queued and sent when the network returns.
- An admin links the Telegram group and adds the bot to it.
- The bot token is kept on the server only, never in the app.
- Original-quality files are sent as documents, so Telegram doesn't compress them.
- Thumbnails are cached on the phone so the gallery opens offline.
- Archived projects keep the gallery viewable and downloadable.
- Limits: roughly 50 MB per upload through the standard Bot API. Telegram is convenient storage but not a guaranteed archive, so the project has a "download all media" option.

## 12. Offline and sync (hard requirement)

- **Local first:** every action saves on the phone instantly. Syncing runs in the background.
- **No duplicates:** every action gets a unique ID on creation. Retrying a sync any number of times records it once.
- **No missing entries:** actions stay in a persistent queue (survives restarts and crashes) until the server confirms them.
- **No overwrite conflicts:** only the owner edits an entry. Admin overrides are separate, ordered versions. Balances are derived, never stored as running totals.
- **Membership and role changes** (approvals, admin succession, removals) are decided by the server in order, so two admins acting offline can't create conflicting states.
- **Visible status:** each entry shows "saved on phone" or "synced".
- **Needs a connection at least once:** first-time login, opening a join link, admin approval of a join request, linking Telegram. Two phones also can't see each other's data until at least one has signal.

## 13. Reports and export

- Summary: totals, per-person spending, who owes whom, category breakdown.
- Export as PDF, Excel/CSV or image.
- Export remains available in archived and trashed projects.

---

## Open items
1. Who can see NID, bank account and bKash numbers? Proposed: bKash and bank visible to all members (needed for payments), NID visible only to the owner and admins.
2. Can any member add a new category, or only admins? Proposed: admins only.
3. "More than half" rule for Group tagging: confirm it, or choose a different threshold.
4. Is the contribution transfer correctly understood (see section 7)?
