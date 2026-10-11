import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function newPhone(browser: Browser) {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto('/');
  await expect(page.getByTestId('new-project')).toBeVisible();
  return { context, page };
}

async function syncNow(page: Page) {
  await page.goto('/');
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-now')).toHaveText(/Sync now/);
}

async function createProject(page: Page, name: string, type: 'group' | 'personal', myName?: string) {
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId(`type-${type}`).click();
  if (myName) await page.getByTestId('my-name').fill(myName);
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('group-total')).toBeVisible();
}

async function addExpense(page: Page, amount: string, description: string, opts: { category?: string } = {}) {
  await page.getByTestId('add-expense').click();
  await page.getByTestId('amount').fill(amount);
  await page.getByTestId('description').fill(description);
  if (opts.category) await page.getByTestId(`cat-${opts.category}`).click();
  await page.getByTestId('save-expense').click();
  await expect(page.getByTestId('save-expense')).toHaveCount(0);
}

test('personal project: calculator, edit history, delete and restore', async ({ browser }) => {
  const { page } = await newPhone(browser);
  await expect(page.getByText('No projects yet')).toBeVisible();
  await createProject(page, 'Daily life', 'personal');
  await expect(page.getByTestId('group-total')).toHaveText('৳0');

  // Calculator in the amount field.
  await page.getByTestId('add-expense').click();
  await page.getByTestId('amount').fill('250+80+40');
  await expect(page.getByTestId('amount-result')).toHaveText('= ৳370');
  await page.getByTestId('amount-calc').click();
  await page.getByTestId('calc-key-equals').click();
  await expect(page.getByTestId('amount')).toHaveValue('370');
  await page.getByTestId('description').fill('Lunch');
  await page.getByTestId('note').fill('with office friends');
  await page.getByTestId('date-yesterday').click();
  await page.screenshot({ path: `${SHOTS}/add-expense.png` });
  await page.getByTestId('save-expense').click();
  await expect(page.getByTestId('group-total')).toHaveText('৳370');

  // Expense list shows description, category, date and note.
  await page.getByTestId('tab-expenses').click();
  const item = page.getByTestId('expense-Lunch');
  await expect(item).toContainText('৳370');
  await expect(item).toContainText('Food');
  await expect(item).toContainText('with office friends');
  await page.screenshot({ path: `${SHOTS}/expense-list.png` });

  // Edit → version 2 is kept in history.
  await item.click();
  await page.getByTestId('edit-expense').click();
  await page.getByTestId('amount').fill('400');
  await page.getByTestId('save-expense').click();
  await expect(page.getByTestId('version-2')).toContainText('Edited');
  await expect(page.getByTestId('version-1')).toContainText('৳370');

  // Restore version 1.
  await page.getByTestId('restore-1').click();
  await expect(page.getByTestId('version-3')).toContainText('Restored');
  await expect(page.getByTestId('entry-current')).toContainText('৳370');

  // Delete, then restore it from the deleted list.
  await page.getByTestId('edit-expense').click();
  await page.getByTestId('delete-expense').click();
  await page.goBack();
  await page.getByTestId('tab-expenses').click();
  await expect(page.getByText('No expenses yet')).toBeVisible();
  await page.getByTestId('toggle-deleted').click();
  await page.getByTestId('expense-Lunch').click();
  await page.getByTestId('restore-3').click();
  await expect(page.getByTestId('entry-current')).toContainText('৳370');
});

test('group project: invite, approval, permissions, split, offline add, settle', async ({ browser }) => {
  const a = await newPhone(browser);
  const b = await newPhone(browser);

  // A creates the group and an invite code.
  await createProject(a.page, 'Cox Trip', 'group', 'Arif');
  await a.page.getByTestId('tab-members').click();
  await a.page.getByTestId('create-invite').click();
  const code = (await a.page.getByTestId('invite-code-value').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  const projectUrl = a.page.url();
  await syncNow(a.page);

  // B finds the project by code and asks to join.
  await b.page.getByTestId('join-project').click();
  await b.page.getByTestId('invite-code').fill('WRONG123');
  await b.page.getByTestId('find-invite').click();
  await expect(b.page.getByTestId('join-message')).toContainText('No active project');
  await b.page.getByTestId('invite-code').fill(code.toLowerCase());
  await b.page.getByTestId('find-invite').click();
  await expect(b.page.getByTestId('invite-found')).toContainText('Cox Trip');
  await b.page.getByTestId('join-name').fill('Bina');
  await b.page.getByTestId('ask-to-join').click();
  await expect(b.page.getByTestId('join-message')).toContainText('Request sent');
  await expect(b.page.getByText('Waiting for admin approval').filter({ visible: true })).toBeVisible();

  // A approves B and allows B to add expenses.
  await syncNow(a.page);
  await a.page.goto(projectUrl);
  await a.page.getByTestId('tab-members').click();
  await expect(a.page.getByTestId('pending-Bina')).toBeVisible();
  await a.page.getByTestId('approve-member').click();
  await expect(a.page.getByTestId('member-Bina')).toBeVisible();
  await a.page.getByTestId('perm-Bina').click();
  await a.page.screenshot({ path: `${SHOTS}/members.png` });
  await syncNow(a.page);

  // B now sees the project and adds a shared expense (default: B paid, everyone shares).
  await syncNow(b.page);
  await b.page.getByTestId('project-Cox Trip').click();
  await expect(b.page.getByTestId('group-total')).toHaveText('৳0');
  await addExpense(b.page, '1000', 'Hotel', { category: 'accommodation' });
  await expect(b.page.getByTestId('my-net')).toHaveText('৳500');

  // B goes offline and adds another expense: it is saved on the phone.
  await b.context.setOffline(true);
  await addExpense(b.page, '300', 'Tea');
  await expect(b.page.getByTestId('group-total')).toHaveText('৳1,300');
  await b.page.goBack(); // in-app navigation; the page is not reloaded while offline
  await b.page.getByTestId('sync-now').click();
  await expect(b.page.getByTestId('sync-banner')).toContainText('Offline');
  await b.page.screenshot({ path: `${SHOTS}/offline.png` });

  // Back online: syncs once, no duplicates.
  await b.context.setOffline(false);
  await syncNow(b.page);
  await syncNow(b.page);
  await syncNow(a.page);
  await a.page.goto(projectUrl);
  await expect(a.page.getByTestId('group-total')).toHaveText('৳1,300');
  await expect(a.page.getByTestId('my-net')).toHaveText('৳650');
  await a.page.getByTestId('tab-expenses').click();
  await expect(a.page.getByTestId('expense-Tea')).toHaveCount(1);
  await expect(a.page.getByTestId('expense-Hotel')).toHaveCount(1);

  // A cannot edit B's entry (only view); A is admin so can override.
  await a.page.getByTestId('expense-Tea').click();
  await expect(a.page.getByTestId('edit-expense')).toBeVisible();
  await a.page.goBack();

  // A pays B what the app suggests; B confirms; both settled.
  await a.page.getByTestId('tab-dashboard').click();
  await expect(a.page.getByTestId('suggested-payment')).toContainText('৳650');
  await a.page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });
  await a.page.getByTestId('suggested-payment').getByText('Settle up').click();
  await expect(a.page.getByTestId('amount-Bina')).toHaveValue('650');
  await a.page.getByTestId('save-settlement').click();
  await syncNow(a.page);
  await syncNow(b.page);
  await b.page.getByTestId('project-Cox Trip').click();
  await b.page.getByTestId('confirm-payment').click();
  await expect(b.page.getByTestId('my-balance')).toContainText('You are settled');
  await syncNow(b.page);
  await syncNow(a.page);
  await a.page.goto(projectUrl);
  await expect(a.page.getByTestId('my-balance')).toContainText('You are settled');
});

test('five themes and Bangla language', async ({ browser }) => {
  const { page } = await newPhone(browser);
  await createProject(page, 'Theme test', 'personal');
  await addExpense(page, '123456', 'Big');
  await page.goto('/');
  const shots = new Set<string>();
  for (const theme of ['light', 'black', 'maroon', 'blue', 'green']) {
    await page.getByTestId('open-settings').click();
    await page.getByTestId(`theme-${theme}`).click();
    await page.goBack();
    const buf = await page.screenshot({ path: `${SHOTS}/theme-${theme}.png` });
    shots.add(buf.toString('base64'));
  }
  expect(shots.size).toBe(5);

  await page.getByTestId('open-settings').click();
  await page.getByTestId('lang-bn').click();
  await expect(page.getByText('চেহারা')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('নতুন প্রজেক্ট')).toBeVisible();
  await page.getByTestId('project-Theme test').click();
  await expect(page.getByTestId('group-total')).toHaveText('৳১,২৩,৪৫৬');
  await page.screenshot({ path: `${SHOTS}/bangla-dashboard.png` });
});

test('backup file restores everything on a new phone, including the account', async ({ browser }) => {
  const a = await newPhone(browser);
  await createProject(a.page, 'Backed up', 'group', 'Arif');
  await addExpense(a.page, '500', 'Bus');
  await syncNow(a.page);
  await a.page.getByTestId('open-settings').click();
  const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.getByTestId('export-backup').click()]);
  const file = test.info().outputPath('backup.json');
  await download.saveAs(file);

  const b = await newPhone(browser);
  await b.page.getByTestId('open-settings').click();
  const [chooser] = await Promise.all([b.page.waitForEvent('filechooser'), b.page.getByTestId('import-backup').click()]);
  await chooser.setFiles(file);
  await b.page.goto('/');
  await syncNow(b.page);
  await b.page.getByTestId('project-Backed up').click();
  await expect(b.page.getByTestId('group-total')).toHaveText('৳500');
  // Same account: the restored phone can keep adding entries that sync.
  await addExpense(b.page, '100', 'Snacks');
  await syncNow(b.page);
  await syncNow(a.page);
  await a.page.getByTestId('project-Backed up').click();
  await expect(a.page.getByTestId('group-total')).toHaveText('৳600');
});
