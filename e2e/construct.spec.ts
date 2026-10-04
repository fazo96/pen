import { expect, type Page, test } from "@playwright/test";
import { command, makeBook, openBook, uniqueId } from "./helpers";

// Construct and the quick actions, on the stub agent the e2e server runs with
// (it answers "Echo: <what it was sent>").

const construct = (page: Page) => page.getByRole("complementary", { name: "Construct" });
const input = (page: Page) => construct(page).getByPlaceholder("Ask Construct");
const replies = (page: Page) => construct(page).locator(".construct-msg.is-agent");

/** Select a word in the manuscript, as a double click would. */
async function selectWord(page: Page, word: string) {
  await page.locator("main .ProseMirror p").first().click();
  await page.evaluate((w) => {
    const editor = (document.querySelector("main .ProseMirror") as any).editor;
    let at = -1;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (at < 0 && node.isText && node.text.includes(w)) at = pos + node.text.indexOf(w);
    });
    editor.chain().focus().setTextSelection({ from: at, to: at + w.length }).run();
  }, word);
}

test("a chat: send, compact, new chat", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("chat"));
  await openBook(page, id);
  await page.getByRole("button", { name: "Construct", exact: true }).click();
  await expect(input(page)).toBeVisible({ timeout: 30_000 });
  await input(page).fill("Hello there");
  await page.keyboard.press("Enter");
  await expect(replies(page).last()).toContainText("Hello there", { timeout: 30_000 });

  await command(page, "Compact Construct");
  await expect(replies(page).last()).toContainText("/compact");

  await command(page, "New Construct chat");
  await expect(construct(page).locator(".construct-msg")).toHaveCount(0);
});

test("Ctrl+Shift+A goes to Construct's input, Esc back to the text", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("chat-keys"));
  await openBook(page, id);
  await page.locator("main .ProseMirror p").first().click();
  await page.keyboard.press("Control+Shift+A");
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("main .ProseMirror")).toBeFocused();
});

test("Synonyms on a selected word answers in a popover, and continues in the chat", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("quick"), "The rain fell at last.");
  await openBook(page, id);
  await selectWord(page, "rain");
  await page.getByRole("toolbar", { name: "Selected words" }).getByRole("button", { name: "Synonyms" }).click();
  const answer = page.getByRole("dialog", { name: "Construct’s answer" });
  await expect(answer).toContainText("Echo:", { timeout: 30_000 });
  await expect(answer).toContainText("rain");
  await answer.getByRole("button", { name: "Continue in Construct" }).click();
  await expect(answer).toBeHidden();
  await expect(replies(page).last()).toContainText("rain", { timeout: 30_000 });
});

test("the palette's Ask… leaves a question in Construct's input", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("ask"), "The harbour was empty.");
  await openBook(page, id);
  await selectWord(page, "harbour");
  await command(page, "Ask Construct about");
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue(/harbour/);
});

test("New chat from the palette waits for a closed Construct to load", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("chat-later"));
  await openBook(page, id);
  await page.getByRole("button", { name: "Construct", exact: true }).click();
  await input(page).fill("Remember this");
  await page.keyboard.press("Enter");
  await expect(replies(page).last()).toContainText("Remember this", { timeout: 30_000 });

  // A fresh page: Construct closed, its conversation not loaded yet.
  await openBook(page, id);
  await command(page, "New Construct chat");
  await expect(input(page)).toBeVisible();
  await expect(construct(page).locator(".construct-msg")).toHaveCount(0);
  // It really started over, rather than showing nothing while loading.
  await page.waitForTimeout(1000);
  await expect(construct(page).locator(".construct-msg")).toHaveCount(0);
});
