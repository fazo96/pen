import { expect, test } from "@playwright/test";
import { command, makeBook, openBook, response, uniqueId } from "./helpers";

// Codex entries: made from the palette, opened beside the manuscript on a wide
// screen, listed in the drawer, deleted.

test("a new entry opens in the side panel and can be deleted", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("codex"));
  await openBook(page, id);

  const created = response(page, "POST", /\/codex$/);
  const loaded = response(page, "GET", /\/codex\/entry$/);
  await command(page, "New Codex entry");
  expect((await created).status()).toBe(201);
  expect((await loaded).status()).toBe(200);
  await expect(page).toHaveURL(/\?entry=entry$/);

  const listed = response(page, "GET", /\/codex$/);
  await command(page, "Show the Codex");
  expect((await listed).status()).toBe(200);

  await page.getByRole("button", { name: "Delete Untitled entry" }).click();
  const deleted = response(page, "DELETE", /\/codex\/entry$/);
  await page.locator(".codex .library-confirm-actions").getByRole("button", { name: "Delete" }).click();
  expect((await deleted).status()).toBe(204);
});

test("+ New entry in the drawer opens the entry's page", async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 900 }); // too narrow for the side panel
  const id = await makeBook(request, uniqueId("codex-narrow"));
  await openBook(page, id);
  await command(page, "Show the Codex");
  await page.getByRole("button", { name: "+ New entry" }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${id}/codex/entry$`));
  await expect(page.locator(".ProseMirror")).toContainText("Untitled entry");
});
