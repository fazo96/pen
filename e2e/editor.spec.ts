import { expect, type Page, test } from "@playwright/test";
import { makeBook, openBook, uniqueId } from "./helpers";

// The editor page's own behaviour: find and replace, the switcher, jumping
// between the manuscript and the Codex panel, focus mode, export.

/** Text of the textblock holding the cursor in the editor that has focus, and where that editor is. */
const cursor = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement?.closest(".ProseMirror") as (HTMLElement & { editor?: any }) | null;
    if (!el?.editor) return null;
    return {
      where: el.closest(".codex-panel") ? "panel" : "manuscript",
      block: el.editor.state.selection.$from.parent.textContent as string,
    };
  });

async function makeEntry(page: Page, id: string, title: string) {
  const res = await page.request.post(`/api/docs/${id}/codex`, { data: { content: `# ${title}\n\nNotes about ${title}.\n` } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test("find and replace in the manuscript", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("find"), "The rain fell. The Rain stopped.\n\nRain again, at last.");
  await openBook(page, id);
  await page.locator(".ProseMirror p").first().click();

  await page.keyboard.press("Control+f");
  const bar = page.getByRole("search", { name: "Find" });
  await expect(bar).toBeVisible();
  await page.keyboard.type("rain");
  await expect(bar.locator(".find-count")).toContainText("3");

  await page.keyboard.press("Control+h");
  const replace = page.getByRole("search", { name: "Find and replace" });
  await replace.getByRole("textbox", { name: "Replace with" }).fill("snow");
  await replace.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("Replaced 3 matches")).toBeVisible();
  await expect(page.locator("main .ProseMirror")).toContainText("The snow fell. The snow stopped.");

  await page.keyboard.press("Escape");
  await expect(replace).toBeHidden();
});

test("the switcher jumps to a chapter", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("toc"), "## Arrival\n\n### The harbour\n\nOne.\n\n### Rain\n\nTwo.");
  await openBook(page, id);
  await page.keyboard.press("Control+o");
  await page.keyboard.type("rain");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(async () => (await page.evaluate(() => (document.querySelector(".ProseMirror") as any).editor.state.selection.$from.parent.textContent))).toBe("Rain");
});

test("the cursor moves between the manuscript and the Codex panel", async ({ page }) => {
  const id = await makeBook(page.request, uniqueId("switch"), "Manuscript text here.");
  const entry = await makeEntry(page, id, "Mara Voss");
  await page.goto(`/d/${id}?entry=${entry}`);
  const panel = page.getByRole("complementary", { name: "Codex entry" });
  await expect(panel.locator(".ProseMirror")).toContainText("Notes about Mara Voss.");

  await page.locator("main .ProseMirror p").first().click();
  await page.keyboard.press("Control+Shift+E");
  await expect.poll(() => cursor(page)).toMatchObject({ where: "panel" });
  await page.keyboard.press("Control+Shift+E");
  await expect.poll(() => cursor(page)).toMatchObject({ where: "manuscript" });
  await page.keyboard.press("Control+Shift+X");
  await expect.poll(() => cursor(page)).toMatchObject({ where: "panel" });
  await page.keyboard.press("Control+Shift+M");
  await expect.poll(() => cursor(page)).toMatchObject({ where: "manuscript" });

  // Closed, the switch brings the entry viewed last back.
  await panel.getByRole("button", { name: "Close entry" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/d/${id}$`));
  await page.keyboard.press("Control+Shift+E");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?entry=${entry}$`));
  await expect.poll(() => cursor(page)).toMatchObject({ where: "panel" });

  // Too narrow for it, the panel closes.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/d/${id}$`));
});

test("on a narrow screen the switch goes between pages", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const id = await makeBook(page.request, uniqueId("narrow"), "Manuscript text here.");
  const entry = await makeEntry(page, id, "Harbour");
  await page.request.put(`/api/docs/${id}/spot`, { data: { entry } });
  await openBook(page, id);
  await page.locator("main .ProseMirror p").first().click();
  await page.keyboard.press("Control+Shift+E");
  await expect(page).toHaveURL(new RegExp(`/d/${id}/codex/${entry}$`));
  await expect(page.locator(".ProseMirror")).toContainText("Notes about Harbour.");
  await expect.poll(() => cursor(page)).toMatchObject({ where: "manuscript" }); // the entry's page has one editor
  await page.keyboard.press("Control+Shift+E");
  await expect(page).toHaveURL(new RegExp(`/d/${id}$`));
});

test("Codex links from the drawer open beside the manuscript, and entries edit and save", async ({ page }) => {
  const id = await makeBook(page.request, uniqueId("panel"), "Manuscript text here.");
  const entry = await makeEntry(page, id, "Lighthouse");
  await openBook(page, id);
  await page.keyboard.press("Control+p");
  await page.keyboard.type("Show the Codex");
  await page.keyboard.press("Enter");
  await page.locator(".codex .library-item", { hasText: "Lighthouse" }).click();
  const panel = page.getByRole("complementary", { name: "Codex entry" });
  await expect(panel.locator(".ProseMirror")).toContainText("Notes about Lighthouse.");

  await panel.locator(".ProseMirror p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Added.");
  await expect.poll(async () => ((await (await page.request.get(`/api/docs/${id}/codex/${entry}`)).json()) as { content: string }).content, { timeout: 15_000 }).toContain("Added.");
});

test("focus mode, and export", async ({ page, request }) => {
  const title = uniqueId("Export Me");
  const id = await makeBook(request, title, "Body text.");
  await openBook(page, id);
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator("html")).toHaveAttribute("data-focus", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveAttribute("data-focus", "");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${id}.md`);
  const text = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(text).toString("utf8")).toBe(`# ${title}\n\nBody text.`);
});

test("curly quotes are straightened on open, a manuscript after saving a version", async ({ page }) => {
  const id = await makeBook(page.request, uniqueId("quotes"), "“Go,” she said. It’s late.");
  const entry = await makeEntry(page, id, "Note");
  await page.request.put(`/api/docs/${id}/codex/${entry}`, {
    data: { content: "# Note\n\n‘Curly’ in an entry.\n", baseVersion: null, force: true },
  });
  await page.goto(`/d/${id}?entry=${entry}`);
  await expect(page.locator("main .ProseMirror")).toContainText(`"Go," she said. It's late.`);
  await expect(page.getByRole("complementary", { name: "Codex entry" }).locator(".ProseMirror")).toContainText("'Curly' in an entry.");
  const versions = (await (await page.request.get(`/api/docs/${id}/versions`)).json()) as { label: string }[];
  expect(versions.map((v) => v.label)).toContain("Before straightening quotes");
  // Autosave writes both back.
  await expect
    .poll(async () => ((await (await page.request.get(`/api/docs/${id}`)).json()) as { content: string }).content, { timeout: 15_000 })
    .toContain(`"Go," she said.`);
  await expect
    .poll(async () => ((await (await page.request.get(`/api/docs/${id}/codex/${entry}`)).json()) as { content: string }).content, { timeout: 15_000 })
    .toContain("'Curly'");
});
