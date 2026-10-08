import { expect, test } from "@playwright/test";
import { type EditorElement, makeBook, openBook, response, uniqueId } from "./helpers";

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

test("writing in a book shows on the library's card and the stats page; pasted text doesn't count", async ({ page, request, context }) => {
  const id = await makeBook(request, uniqueId("stats"), "First line.");
  await openBook(page, id);
  // At the end of the text: words typed there are drafting, words typed before it editing.
  await page.evaluate(() => (document.querySelector(".ProseMirror") as EditorElement).editor.commands.focus("end"));
  const saved = response(page, "PUT", new RegExp(`^/api/docs/${id}$`));
  await page.keyboard.press("Enter");
  await page.keyboard.type("Five new words typed here.");
  expect((await saved).status()).toBe(200);

  // A paste: counted by the editor and sent with the next save, which leaves it out.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("These six words were pasted in."));
  const pasted = page.waitForRequest(
    (r) => r.method() === "PUT" && new URL(r.url()).pathname === `/api/docs/${id}` && /"pasted":6/.test(r.postData() ?? ""),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+v");
  await pasted;

  await expect(async () => {
    await page.goto("/stats");
    await page.getByRole("radio", { name: "Today" }).click();
    const book = page.locator(".wstats-book select");
    if (await book.isVisible()) await book.selectOption(id);
    await expect(page.locator(".wstats-figures")).toContainText("5 words", { timeout: 1000 });
    await expect(page.getByText("6 pasted words aren’t counted.")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.locator(".wstats-work")).toHaveText("Mostly drafting (100%)");

  await page.goto("/?library");
  await expect(page.locator(".wcard")).toContainText("words today");
  await page.locator(".wcard").getByRole("link", { name: "All stats →" }).click();
  await expect(page).toHaveURL(/\/stats$/);
});

test("cutting text and pasting it back, a save later, moves it: nothing removed or written", async ({ page, request, context }) => {
  const id = await makeBook(request, uniqueId("moves"), "First line.\n\nThese five words get moved.");
  await openBook(page, id);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => (document.querySelector(".ProseMirror") as EditorElement).editor.commands.focus("end"));
  const cut = response(page, "PUT", new RegExp(`^/api/docs/${id}$`));
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+x");
  expect((await cut).status()).toBe(200);

  // Back in, before the first line.
  await page.evaluate(() => {
    const { editor } = document.querySelector(".ProseMirror") as EditorElement;
    let at = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "First line.") at = pos + 1;
    });
    editor.commands.focus(at);
  });
  const moved = page.waitForRequest(
    (r) => r.method() === "PUT" && new URL(r.url()).pathname === `/api/docs/${id}` && /"moved":5/.test(r.postData() ?? ""),
  );
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Enter");
  await moved;

  await expect(async () => {
    const report = (await (await request.get("/api/stats")).json()) as {
      slots: { book: string; drafted: number; editAdded: number; removed: number; moved: number }[];
    };
    const mine = report.slots.filter((s) => s.book === id);
    expect(mine.map((s) => [s.drafted, s.editAdded, s.removed, s.moved])).toEqual([[0, 0, 0, 5]]);
  }).toPass();
  await page.goto("/stats");
  await page.getByRole("radio", { name: "Today" }).click();
  const book = page.locator(".wstats-book select");
  if (await book.isVisible()) await book.selectOption(id);
  await expect(page.getByText("5 moved words aren’t counted.")).toBeVisible();
});
