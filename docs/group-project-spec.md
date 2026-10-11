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
- **Add-expense permission:** by default a member can view but not add expenses. An admin grants the "can add expenses" permission per member (and can take it back), so nobody adds entries or categories by mistake. Admins always have it.
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
- Any member with the add-expense permission can add a new category while entering an expense. Admins can also rename and hide categories.

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
- **Contribution transfer:** a member (A) gives money to one **or several** members (B, C) at once, recorded as one entry with an amount per recipient. Each recipient confirms their part.
  - It works exactly like a settlement payment of dues: it adjusts the balances of the giver and the receivers.
  - It is **not an expense**: it never adds to the group total, the budget spent, or anyone's costs.
  - It is added to the giver's **contribution** figure in the project, which shows in the Members tab and the member's own breakdown.
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
- An admin links the Telegram group and adds the bot to it (step-by-step in Appendix A).
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

## Decisions confirmed
- bKash and bank details are visible to all members. NID is visible only to the owner and admins.
- Group tagging uses the "more than half of members" rule.
- Contribution transfers work as settlement payments and never count as costs.

---

## Appendix A: Creator's guide to Telegram and WhatsApp groups

Both groups are optional. Telegram gives you the photo gallery. WhatsApp is only a chat link (it cannot store gallery media).

### A1. Telegram group + gallery (recommended)
1. **Create the group.** In Telegram: tap the pencil/new-message icon → *New Group* → add at least one person (you can remove them later) → name it after your project → *Create*.
2. **Get the invite link.** Open the group → tap the group name → *Invite to Group via Link* (or *Add Members → Invite via link*) → *Copy link*. Paste it into your project's **Telegram link** field in the app. New members see it after they are approved.
3. **Open the app's linking screen.** In the project → Settings → *Gallery / Telegram* → *Link Telegram group*. The app shows a short one-time code (for example `K7Q-29M`) and the bot's username.
4. **Add the bot to the group.** In the Telegram group → *Add Member* → search the bot's username → add it.
5. **Make the bot an admin (recommended).** Group info → *Administrators* → *Add Administrator* → pick the bot. Only the "Post messages" and "Delete messages" rights are needed. This prevents delivery problems in larger groups.
6. **Link.** In the group chat send: `/link K7Q-29M`. The bot replies "Linked to <Project name>", and the app shows the Gallery as connected. The code expires after 15 minutes and works once.
7. **Upload.** Members upload from the Gallery tab. The photo is relayed into the Telegram group and shows in the app gallery.

Tips:
- Everyone in the Telegram group can see the photos, so only invite project members via the link, and keep the group private.
- If you remove the bot or delete the group, the gallery stops working. Use *Download all media* regularly.
- To unlink: project Settings → *Gallery / Telegram* → *Unlink* (the old photos stay in Telegram).
- Optional, for advanced creators: you can use your own bot instead of the app's bot. In Telegram open *@BotFather* → send `/newbot` → choose a name and username → copy the token it gives you → paste it in *Gallery / Telegram → Use my own bot*. Then follow steps 4 to 6 with your own bot. Never share the token anywhere else.

### A2. WhatsApp group
1. **Create the group.** WhatsApp → *New chat* → *New group* → add members → name it after the project → create.
2. **Get the invite link.** Open the group → tap the group name → *Invite to group via link* → *Copy link*.
3. **Add it to the project.** Paste the link into the project's **WhatsApp link** field in the app.
4. **Use it.** Members approved into the project see this link and can join the chat. The app's reminder generator opens WhatsApp with a ready message (for example a settlement reminder) that you send yourself. The app does not read or post in WhatsApp automatically.

### A3. What the creator should do on day one
1. Create the project (name only is required), set the budget if known.
2. Create the Telegram and/or WhatsApp group and paste the links.
3. Share the project's join link/QR in the chat.
4. Approve join requests, then grant "can add expenses" to the members who should record costs.
