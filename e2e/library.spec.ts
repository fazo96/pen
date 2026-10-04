import { expect, test } from "@playwright/test";
import { makeBook, openBook, response, uniqueId } from "./helpers";

// The library, the switcher's lists, book settings and the grammar checker's
// requests: the remaining screens that talk to the API through lib/api.ts.

test("the switcher lists the other books", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("switch-a"));
  const other = await makeBook(request, uniqueId("switch-b"));
  await openBook(page, id);
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("dialog", { name: "Go to" }).getByText(other)).toBeVisible();
});

test("grammar checking loads its settings and checks the text", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("grammar"), "This are a sentence with a mistake.");
  const settings = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/grammar");
  const checked = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/grammar/check");
  await openBook(page, id);
  expect((await settings).status()).toBe(200);
  expect((await checked).status()).toBe(200);
});

test("book settings move a book to another shelf", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("settings"));
  const res = await request.put("/api/shelves", {
    data: { shelves: [{ id: "one", name: "One", books: [id] }, { id: "two", name: "Two", books: [] }] },
  });
  expect(res.status()).toBe(200);
  await page.goto(`/d/${id}/settings`);
  const moved = response(page, "PUT", /^\/api\/shelves$/);
  await page.locator("select").selectOption("two");
  expect((await moved).status()).toBe(200);
  await expect(page.getByText("Moved to “Two”.")).toBeVisible();
});

test("a new manuscript from the library", async ({ page }) => {
  await page.goto("/?library");
  await page.getByRole("button", { name: /New manuscript/ }).first().click();
  const title = uniqueId("Fresh Book");
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/d/${title.toLowerCase().replace(" ", "-")}$`));
  await expect(page.locator(".ProseMirror h1")).toHaveText(title);
});
