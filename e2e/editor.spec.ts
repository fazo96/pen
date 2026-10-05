import { expect, type Page, test } from "@playwright/test";
import { type EditorElement, makeBook, openBook, uniqueId } from "./helpers";

// The editor page's own behaviour: find and replace, the switcher, jumping
// between the manuscript and the Codex panel, focus mode, export.

/** Text of the textblock holding the cursor in the editor that has focus, and where that editor is. */
const cursor = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement?.closest(".ProseMirror") as (HTMLElement & Partial<Pick<EditorElement, "editor">>) | null;
    if (!el?.editor) return null;
    return {
      where: el.closest(".codex-panel") ? "panel" : "manuscript",
      block: el.editor.state.selection.$from.parent.textContent,
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
  await expect.poll(async () => (await page.evaluate(() => (document.querySelector(".ProseMirror") as EditorElement).editor.state.selection.$from.parent.textContent))).toBe("Rain");
});

test("the paragraph style menu makes a line a scene, and text again", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("style"), "### One\n\nThe fog came.\n\nIt stayed.");
  await openBook(page, id);
  await page.locator(".ProseMirror p").first().click();
  const markdown = () => page.evaluate(() => (document.querySelector(".ProseMirror") as EditorElement).editor.getMarkdown());

  const style = page.getByRole("button", { name: "Paragraph style: Text" });
  await style.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio", { name: "Text" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "Scene" }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".ProseMirror h4")).toHaveText("The fog came.");
  await expect.poll(markdown).toContain("#### The fog came.");
  await expect(page.getByRole("button", { name: "Paragraph style: Scene" })).toBeVisible();
  // The cursor stayed in the text.
  await expect.poll(() => cursor(page)).toEqual({ where: "manuscript", block: "The fog came." });

  await page.getByRole("button", { name: "Paragraph style: Scene" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Paragraph style: Scene" }).click();
  await menu.getByRole("menuitemradio", { name: "Text" }).click();
  await expect(page.locator(".ProseMirror h4")).toHaveCount(0);
  await expect.poll(markdown).toContain("### One\n\nThe fog came.");
});

test("the grammar check leaves Codex entries alone", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("nogrammar"), "She walkd to teh harbour.");
  const eid = await makeEntry(page, id, "Mara");
  await page.request.put(`/api/docs/${id}/codex/${eid}`, {
    data: { content: "# Mara\n\nShe walkd to teh harbour.\n", baseVersion: (await (await page.request.get(`/api/docs/${id}/codex/${eid}`)).json()).version },
  });
  await page.goto(`/d/${id}?entry=${eid}`);
  const panel = page.locator(".codex-panel .ProseMirror");
  await expect(panel).toContainText("teh harbour");
  await expect(page.locator("main .ProseMirror .grammar-flag").first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator(".grammar-flag")).toHaveCount(0);
  await expect(panel).toHaveAttribute("spellcheck", "false");

  // An entry's own page: nothing flagged, and no Grammar tab to list nothing.
  await page.goto(`/d/${id}/codex/${eid}`);
  await expect(page.locator(".ProseMirror")).toContainText("teh harbour");
  await page.waitForTimeout(2500); // past the checker's first pass on the manuscript
  await expect(page.locator(".ProseMirror .grammar-flag")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Grammar/ })).toHaveCount(0);
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

test("find searches the editor used last, and leaves with it", async ({ page }) => {
  const id = await makeBook(page.request, uniqueId("find-panel"), "Rain on the manuscript.");
  const entry = await makeEntry(page, id, "Storm");
  await page.goto(`/d/${id}?entry=${entry}`);
  const panel = page.getByRole("complementary", { name: "Codex entry" });
  await panel.locator(".ProseMirror p").click();
  await page.keyboard.press("Control+f");
  const bar = panel.getByRole("search", { name: "Find" });
  await expect(bar).toBeVisible();
  await page.keyboard.type("storm");
  await expect(bar.locator(".find-count")).toContainText("2"); // the title and "Notes about Storm."
  await page.keyboard.press("Control+g");
  await expect(bar.locator(".find-count")).toContainText("2");
  await panel.getByRole("button", { name: "Close entry" }).click();
  await expect(page.getByRole("search")).toHaveCount(0);
});

test("deleting the entry open beside the manuscript closes the panel", async ({ page }) => {
  const id = await makeBook(page.request, uniqueId("drop"), "Manuscript text here.");
  const entry = await makeEntry(page, id, "Doomed");
  await page.goto(`/d/${id}?entry=${entry}`);
  const panel = page.getByRole("complementary", { name: "Codex entry" });
  await expect(panel.locator(".ProseMirror")).toContainText("Notes about Doomed.");
  await page.keyboard.press("Control+p");
  await page.keyboard.type("Show the Codex");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Delete Doomed" }).click();
  await page.locator(".codex .library-confirm-actions").getByRole("button", { name: "Delete" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/d/${id}$`));
  // Not saved back into existence.
  await page.waitForTimeout(1500);
  expect((await page.request.get(`/api/docs/${id}/codex/${entry}`)).status()).toBe(404);
});

test("on a phone, the top bar's tools are in the More menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const id = await makeBook(page.request, uniqueId("phone"), "Rain on a small screen.");
  await openBook(page, id);
  const more = page.getByRole("button", { name: "More" });
  const find = page.getByRole("menuitem", { name: "Find" });
  // Escape and a press outside close it.
  await more.click();
  await page.keyboard.press("Escape");
  await expect(find).toBeHidden();
  await more.click();
  await page.mouse.click(195, 760); // the text, below the menu
  await expect(find).toBeHidden();
  await more.click();
  await find.click();
  await expect(page.getByRole("search", { name: "Find" })).toBeVisible();
  await page.keyboard.press("Escape");
  await more.click();
  await page.getByRole("menuitemcheckbox", { name: /Grammar/ }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: /Grammar/ })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemcheckbox", { name: /Grammar/ }).click(); // back on, for the tests after
  await page.getByRole("menuitem", { name: "Book settings" }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${id}/settings$`));
});

test("the save status explains itself: when it saved, and offline", async ({ page, context }) => {
  const id = await makeBook(page.request, uniqueId("status"), "Status text.");
  await openBook(page, id);
  const status = page.locator(".topbar-right .save-status");
  const pop = status.locator(".save-status-pop");

  await page.locator("main .ProseMirror p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await expect(status.locator(".status-label")).toHaveText("Saved", { timeout: 15_000 });
  await status.locator(".status").hover();
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("All saved.");
  await expect(pop).toContainText(/Last saved from this device\s*\d\d:\d\d \(just now\)/);
  await expect(pop).toContainText(/Last reached the server\s*\d\d:\d\d \(just now\)/);

  await context.setOffline(true);
  await page.locator("main .ProseMirror p").first().click();
  await page.keyboard.type(" Away.");
  await expect(status.locator(".status-label")).toHaveText("Offline", { timeout: 15_000 });
  await status.locator(".status").hover();
  await expect(pop).toContainText("Can’t reach the server");
  await context.setOffline(false);
  await expect(status.locator(".status-label")).toHaveText("Saved", { timeout: 15_000 });

  // On a phone only the dot shows; a tap opens it, Escape closes it.
  await page.setViewportSize({ width: 390, height: 800 });
  await status.locator(".status").click();
  await expect(status.locator(".status")).toHaveAttribute("aria-expanded", "true");
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(status.locator(".status")).toHaveAttribute("aria-expanded", "false");
});

test("a click on the page around a short text focuses the editor", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("margin"), "Short.\n\nSecond line.");
  await page.setViewportSize({ width: 1200, height: 900 });
  await openBook(page, id);
  const editor = page.locator(".ProseMirror");
  const box = (await editor.boundingBox())!;
  const atEnd = () =>
    page.evaluate(() => {
      const { state } = (document.querySelector(".ProseMirror") as EditorElement).editor;
      return state.selection.from === state.doc.content.size - 1;
    });

  // Well below the text, on the page: the end of the document.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 200);
  expect(await cursor(page)).toEqual({ where: "manuscript", block: "Second line." });
  expect(await atEnd()).toBe(true);

  // Beside the first line, just right of the text column: that line.
  const first = (await editor.locator("p").first().boundingBox())!;
  await page.mouse.click(box.x + box.width + 12, first.y + first.height / 2);
  expect(await cursor(page)).toEqual({ where: "manuscript", block: "Short." });

  // Typing goes where the cursor went.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 200);
  await page.keyboard.type(" More.");
  await expect(editor.locator("p").last()).toHaveText("Second line. More.");
});

test("a click below a short Codex entry in the side panel focuses it", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("margin-panel"));
  const entry = await makeEntry(page, id, "Harbour");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/d/${id}?entry=${entry}`);
  const panelEditor = page.locator(".codex-panel .ProseMirror");
  await expect(panelEditor).toContainText("Notes about Harbour.");
  const box = (await panelEditor.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 150);
  await expect.poll(() => cursor(page)).toEqual({ where: "panel", block: "Notes about Harbour." });
});
