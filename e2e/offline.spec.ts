import { expect, type Page, test } from "@playwright/test";
import { command, makeBook, openBook, uniqueId } from "./helpers";

// Offline (public/sw.js, lib/offline.ts): a book opened once opens again
// without a connection, with what this device saved since, and what's
// written offline saves when the connection returns.

// A page kept from next dev doesn't come back to life offline (its dev
// runtime wants the server), so these need a production build: PEN_E2E_URL.
test.skip(!process.env.PEN_E2E_URL, "needs a production build (PEN_E2E_URL)");

// The service worker only runs in production builds unless this is set.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("pen:sw", "1"));
});

/** Wait until the service worker controls the page and has kept it. */
async function kept(page: Page, key: string) {
  await page.waitForFunction(
    async (k) => !!navigator.serviceWorker.controller && !!(await (await caches.open("pen-pages")).match(k)),
    key,
  );
}

const serverText = async (page: Page, id: string) =>
  ((await (await page.request.get(`/api/docs/${id}`)).json()) as { content: string }).content;

test("a book opened before opens offline, and what's written there saves once back online", async ({ page, context }) => {
  const id = await makeBook(page.request, uniqueId("offline"), "First line.");
  await openBook(page, id);
  await kept(page, `/d/${id}`);

  // Saved online after the page was kept: offline, this newer copy wins over the kept page.
  const text = page.locator("main .ProseMirror");
  await text.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Saved online.");
  await expect.poll(() => serverText(page, id), { timeout: 15_000 }).toContain("Saved online.");

  await context.setOffline(true);
  await page.reload();
  await expect(text).toContainText("First line. Saved online.");

  await text.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Written offline.");
  await expect(page.locator(".status-label").first()).toHaveText("Offline", { timeout: 15_000 });

  // A reload while still offline keeps the unsent words.
  await page.reload();
  await expect(text).toContainText("Saved online. Written offline.");

  await context.setOffline(false);
  await expect.poll(() => serverText(page, id), { timeout: 20_000 }).toContain("Saved online. Written offline.");
});

test("a page never opened here says so offline", async ({ page, context }) => {
  const id = await makeBook(page.request, uniqueId("never"), "Text.");
  await openBook(page, id);
  await kept(page, `/d/${id}`);
  await context.setOffline(true);
  await page.goto(`/d/${id}/settings`);
  await expect(page.getByRole("heading", { name: "No connection" })).toBeVisible();
});

test("a book reached by an in-app link is kept too", async ({ page, context }) => {
  const name = uniqueId("Linked");
  const id = await makeBook(page.request, name, "Reached by a link.");
  await page.goto("/?library");
  await kept(page, "/?library");
  await page.locator(`a[href="/d/${id}"]`).first().click();
  await expect(page.locator("main .ProseMirror")).toContainText("Reached by a link.");
  await kept(page, `/d/${id}`);

  await context.setOffline(true);
  await page.goto(`/d/${id}`);
  await expect(page.locator("main .ProseMirror")).toContainText("Reached by a link.");
});

test("the Codex list and an entry opened beside the manuscript work offline", async ({ page, context }) => {
  const id = await makeBook(page.request, uniqueId("codex-offline"), "Manuscript.");
  const res = await page.request.post(`/api/docs/${id}/codex`, { data: { content: "# Harbour\n\nNotes about the harbour.\n" } });
  const entry = ((await res.json()) as { id: string }).id;
  await openBook(page, id);
  await kept(page, `/d/${id}`);
  await command(page, "Show the Codex");
  await page.locator(".codex .library-item", { hasText: "Harbour" }).click();
  const panel = page.getByRole("complementary", { name: "Codex entry" });
  await expect(panel.locator(".ProseMirror")).toContainText("Notes about the harbour.");

  await context.setOffline(true);
  await page.goto(`/d/${id}?entry=${entry}`);
  await expect(panel.locator(".ProseMirror")).toContainText("Notes about the harbour.");
  await command(page, "Show the Codex");
  await expect(page.locator(".codex .library-item", { hasText: "Harbour" })).toBeVisible();
});
