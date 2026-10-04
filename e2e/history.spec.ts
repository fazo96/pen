import { expect, test } from "@playwright/test";
import { command, makeBook, openBook, response, uniqueId } from "./helpers";

// The History tab: saving, renaming, previewing, restoring and deleting versions.

test("versions from History and the palette", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("history"));
  await openBook(page, id);

  const listed = response(page, "GET", /\/versions$/);
  await command(page, "Show history");
  expect((await listed).status()).toBe(200);
  const history = page.locator(".history");

  await history.getByRole("button", { name: "+ Save a version" }).click();
  const saved = response(page, "POST", /\/versions$/);
  await history.locator(".history-save input").fill("Draft one");
  await page.keyboard.press("Enter");
  expect((await saved).status()).toBe(201);
  await expect(history.getByText("Draft one")).toBeVisible();

  await page.getByRole("button", { name: "Rename version Draft one" }).click();
  const renamed = response(page, "PATCH", /\/versions\/[^/]+$/);
  await page.getByRole("textbox", { name: "Version name" }).fill("Draft 1b");
  await page.keyboard.press("Enter");
  expect((await renamed).status()).toBe(200);
  await expect(history.getByText("Draft 1b")).toBeVisible();

  // Preview it, then restore it.
  const read = response(page, "GET", /\/versions\/[^/]+$/);
  await history.locator(".version-item", { hasText: "Draft 1b" }).click();
  expect((await read).status()).toBe(200);
  const bar = page.getByRole("region", { name: "Viewing a version" });
  await bar.getByRole("button", { name: "Restore…" }).click();
  const restored = response(page, "POST", /\/restore$/);
  await bar.getByRole("button", { name: "Restore", exact: true }).click();
  expect((await restored).status()).toBe(200);
  await expect(bar).toBeHidden();

  // The palette's Save version… asks for a name, then says so.
  await command(page, "Save version");
  await page.keyboard.type("From palette");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Saved version “From palette”")).toBeVisible();

  await command(page, "Show history");
  await page.getByRole("button", { name: "Delete version Draft 1b" }).click();
  const deleted = response(page, "DELETE", /\/versions\/[^/]+$/);
  await history.locator(".library-confirm-actions").getByRole("button", { name: "Delete" }).click();
  expect((await deleted).status()).toBe(204);
  await expect(history.getByText("Draft 1b")).toBeHidden();
});
