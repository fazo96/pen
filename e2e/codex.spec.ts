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

test("the Global Codex: from the library, its list on the left and Construct on the right", async ({ page, request }) => {
  const name = uniqueId("Shared Style");
  const res = await request.post("/api/docs/_global/codex", { data: { content: `# ${name}\n\nSerial commas.` } });
  const { id: entry } = (await res.json()) as { id: string };
  await makeBook(request, uniqueId("global-shelf")); // so the library shows, not a lone book

  await page.goto("/?library");
  await page.getByRole("link", { name: "Global Codex" }).click();
  await expect(page).toHaveURL(/\/codex\/[a-z0-9-]+$/);
  // The drawer is the left rail on wide screens, open on the Codex tab.
  await page.locator(".codex .library-item", { hasText: name }).click();
  await expect(page).toHaveURL(new RegExp(`/codex/${entry}$`));
  await expect(page.locator(".ProseMirror")).toContainText("Serial commas.");
  await expect(page.locator(".topbar-title")).toHaveText(`Global Codex · ${name}`);
  await expect(page.getByRole("button", { name: "Construct" }).first()).toBeVisible();
  await request.delete(`/api/docs/_global/codex/${entry}`);
});

test("in a book, Global Codex entries open beside the manuscript, and entries move both ways", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("global-book"));
  const own = uniqueId("Harbour");
  const shared = uniqueId("World Rules");
  const mine = (await (await request.post(`/api/docs/${id}/codex`, { data: { content: `# ${own}\n\nFog.` } })).json()) as { id: string };
  const theirs = (await (await request.post("/api/docs/_global/codex", { data: { content: `# ${shared}\n\nNo magic.` } })).json()) as {
    id: string;
  };
  await openBook(page, id);
  await command(page, "Show the Codex");
  const global = page.getByRole("region", { name: "Global Codex" });

  // A Global Codex entry, beside the manuscript.
  await global.locator(".library-item", { hasText: shared }).click();
  await expect(page).toHaveURL(new RegExp(`\\?entry=global%2F${theirs.id}$`));
  await expect(page.locator(".codex-panel-title")).toHaveText(`Global Codex · ${shared}`);

  // The book's own entry, open beside the manuscript, moves to the Global Codex and the panel follows it.
  await page.locator(".codex > .outline-list .library-item", { hasText: own }).click();
  await expect(page.locator(".codex-panel-title")).toHaveText(`Codex · ${own}`);
  const moved = response(page, "POST", new RegExp(`/codex/${mine.id}/move$`));
  await page.getByRole("button", { name: `Move ${own} to the Global Codex` }).click();
  expect((await moved).status()).toBe(200);
  await expect(global.locator(".library-item", { hasText: own })).toBeVisible();
  await expect(page.locator(".codex-panel-title")).toHaveText(`Global Codex · ${own}`);
  await expect(page).toHaveURL(new RegExp(`\\?entry=global%2F${mine.id}$`));

  // And the shared one into the book.
  await global.getByRole("button", { name: `Move ${shared} to this book` }).click();
  await expect(page.locator(".codex > .outline-list .library-item", { hasText: shared })).toBeVisible();
  expect((await request.get(`/api/docs/${id}/codex/${theirs.id}`)).status()).toBe(200);
  expect((await request.get(`/api/docs/_global/codex/${theirs.id}`)).status()).toBe(404);
  await request.delete(`/api/docs/_global/codex/${mine.id}`);
});
