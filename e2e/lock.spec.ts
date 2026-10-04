import { expect, test } from "@playwright/test";
import { makeBook, uniqueId } from "./helpers";

// The lock: set from /settings, asked for on another device, removed. Ends
// unlocked even when a step fails, so the tests after it can still work.

const PASSWORD = "correct horse";

test.afterEach(async ({ request }) => {
  // Signed in or not, this removes the lock if it's still there.
  const unlock = await request.post("/api/auth", { data: { action: "unlock", password: PASSWORD } });
  if (unlock.ok()) await request.post("/api/auth", { data: { action: "remove", current: PASSWORD } });
});

test("lock, unlock elsewhere, remove", async ({ page, browser, request }) => {
  const id = await makeBook(request, uniqueId("lock"));

  await page.goto("/settings");
  await page.getByRole("button", { name: "Lock this desk" }).click();
  for (const field of await page.locator('.lock-form input[type="password"]').all()) await field.fill(PASSWORD);
  await page.locator('.lock-form button[type="submit"]').click();
  await expect(page.getByRole("button", { name: "Remove lock" })).toBeVisible();

  // Another browser has no session: it's sent to /unlock.
  const other = await browser.newContext();
  const elsewhere = await other.newPage();
  await elsewhere.goto(`/d/${id}`);
  await expect(elsewhere).toHaveURL(/\/unlock/);
  expect((await elsewhere.request.get("/api/docs")).status()).toBe(401);
  await elsewhere.locator('input[type="password"]').fill("wrong password");
  await elsewhere.keyboard.press("Enter");
  await expect(elsewhere.getByText("Wrong password.")).toBeVisible();
  await elsewhere.locator('input[type="password"]').fill(PASSWORD);
  await elsewhere.keyboard.press("Enter");
  await expect(elsewhere).toHaveURL(new RegExp(`/d/${id}$`));
  await other.close();

  await page.getByRole("button", { name: "Remove lock" }).click();
  await page.locator('.lock-form input[type="password"]').fill("nope nope");
  await page.locator('.lock-form button[type="submit"]').click();
  await expect(page.getByText("Wrong password.")).toBeVisible();
  await page.locator('.lock-form input[type="password"]').fill(PASSWORD);
  await page.locator('.lock-form button[type="submit"]').click();
  await expect(page.getByRole("button", { name: "Lock this desk" })).toBeVisible();
});
