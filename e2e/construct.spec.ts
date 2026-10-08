import { expect, type Page, test } from "@playwright/test";
import { command, type EditorElement, makeBook, openBook, uniqueId } from "./helpers";

// Construct and the quick actions, on the stub agent the e2e server runs with
// (it answers "Echo: <what it was sent>").

const construct = (page: Page) => page.getByRole("complementary", { name: "Construct" });
const input = (page: Page) => construct(page).getByPlaceholder("Ask Construct");
const replies = (page: Page) => construct(page).locator(".construct-msg.is-agent");

/** Select a word in the manuscript, as a double click would. */
async function selectWord(page: Page, word: string) {
  await page.locator("main .ProseMirror p").first().click();
  await page.evaluate((w) => {
    const editor = (document.querySelector("main .ProseMirror") as EditorElement).editor;
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.text?.includes(w)) at = pos + node.text.indexOf(w);
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

test("the AGENTS entry is in the system prompt, and an edit to it reaches the chat once", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("agents"));
  const made = await request.post(`/api/docs/${id}/codex`, { data: { content: "# AGENTS\n\nBritish spelling.\n" } });
  expect(((await made.json()) as { id: string }).id).toBe("agents");
  await openBook(page, id);
  await page.getByRole("button", { name: "Construct", exact: true }).click();
  await expect(input(page)).toBeVisible({ timeout: 30_000 });
  const send = async (text: string) => {
    await input(page).fill(text);
    await page.keyboard.press("Enter");
    await expect(replies(page).last()).toContainText(text, { timeout: 30_000 });
    return (await replies(page).last().textContent()) ?? "";
  };

  // Read when the agent started: not sent again with the message.
  expect(await send("First")).not.toContain("standing instructions");

  const entry = await (await request.get(`/api/docs/${id}/codex/agents`)).json();
  const saved = await request.put(`/api/docs/${id}/codex/agents`, { data: { content: "# AGENTS\n\nBe blunt.\n", baseVersion: entry.version } });
  expect(saved.ok()).toBe(true);
  const second = await send("Second");
  expect(second).toContain("updated their standing instructions");
  expect(second).toContain("Be blunt.");
  expect(await send("Third")).not.toContain("standing instructions");
});

test("the Chats list opens, renames and deletes chats", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("chats"));
  await openBook(page, id);
  await page.getByRole("button", { name: "Construct", exact: true }).click();
  await expect(input(page)).toBeVisible({ timeout: 30_000 });
  const panel = construct(page);
  for (const text of ["First question", "Second question"]) {
    if (text.startsWith("Second")) await panel.getByRole("button", { name: "New chat" }).click();
    await input(page).fill(text);
    await page.keyboard.press("Enter");
    await expect(replies(page).last()).toContainText(text, { timeout: 30_000 });
  }
  const chats = panel.getByRole("list", { name: "Chats" });
  const titles = chats.locator(".construct-chat-title");
  await panel.getByRole("button", { name: "Chats", exact: true }).click();
  await expect(titles).toHaveText(["Second question", "First question"]);

  await chats.getByRole("button", { name: "Rename “First question”" }).click();
  await chats.getByLabel("Chat name").fill("Mara");
  await page.keyboard.press("Enter");
  await expect(titles).toHaveText(["Second question", "Mara"]);

  await titles.filter({ hasText: "Mara" }).click();
  await expect(chats).toBeHidden();
  await expect(replies(page)).toHaveText([/First question/]);

  await panel.getByRole("button", { name: "Chats", exact: true }).click();
  await chats.getByRole("button", { name: "Delete “Second question”" }).click();
  await chats.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(titles).toHaveText(["Mara"]);
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

test("the quick answer closes on a click elsewhere in the text, or its close button", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("quick-close"), "The rain fell at last.");
  await openBook(page, id);
  const answer = page.getByRole("dialog", { name: "Construct’s answer" });
  const synonyms = page.getByRole("toolbar", { name: "Selected words" }).getByRole("button", { name: "Synonyms" });

  await selectWord(page, "rain");
  await synonyms.click();
  await expect(answer).toBeVisible();
  // Inside the editor, so not an outside press: the selection leaving the word closes it.
  await page.locator("main .ProseMirror p").first().click({ position: { x: 2, y: 2 } });
  await expect(answer).toBeHidden();

  await selectWord(page, "rain");
  await synonyms.click();
  await answer.getByRole("button", { name: "Close" }).click();
  await expect(answer).toBeHidden();
  await expect(page.locator("main .ProseMirror")).toContainText("The rain fell at last.");
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

/** Send a message and wait for the echo; its citation chips are the reply's. */
async function say(page: Page, text: string) {
  const before = await replies(page).count();
  await input(page).fill(text);
  await page.keyboard.press("Enter");
  await expect(replies(page)).toHaveCount(before + 1, { timeout: 30_000 });
  return replies(page).nth(before);
}

test("citation chips show the passage, in the manuscript or in a version", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("cite"), "First paragraph here.\n\nSecond paragraph about the harbour.");
  const version = await request.post(`/api/docs/${id}/versions`, {
    data: { label: "Old", content: "# Old\n\nOld words in the version.\n", created: 1000 },
  });
  const vid = ((await version.json()) as { id: string }).id;
  await openBook(page, id);
  await page.getByRole("button", { name: "Construct", exact: true }).click();

  // Line 5 of the manuscript: the second paragraph.
  let reply = await say(page, "Look at [the harbour](pen:L5)");
  await reply.locator("[data-cite]").click();
  await expect(page.locator("main .ProseMirror .is-cited")).toHaveText("Second paragraph about the harbour.");

  reply = await say(page, `And [the old one](pen:v/${vid}/L3)`);
  await reply.locator("[data-cite]").click();
  await expect(page.getByRole("region", { name: "Viewing a version" })).toBeVisible();
  await expect(page.locator(".is-preview .is-cited")).toHaveText("Old words in the version.");

  reply = await say(page, "And [nothing](pen:L99)");
  await reply.locator("[data-cite]").click();
  await expect(reply.locator("[data-cite]")).toHaveClass(/is-missing/);
});

test("a citation followed from a Codex entry's page opens the manuscript there", async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 900 }); // the entry on its own page
  const id = await makeBook(request, uniqueId("cite-entry"), "First paragraph here.\n\nSecond paragraph about the harbour.");
  const created = await request.post(`/api/docs/${id}/codex`, { data: { content: "# Note\n\nA note.\n" } });
  const entry = ((await created.json()) as { id: string }).id;
  await page.goto(`/d/${id}/codex/${entry}`);
  await page.getByRole("button", { name: "Construct" }).first().click();
  const reply = await say(page, "Look at [the harbour](pen:L5)");
  await reply.locator("[data-cite]").click();
  await expect(page).toHaveURL(new RegExp(`/d/${id}(\\?|$)`)); // ?cite= is dropped from the address once read
  await expect(page.locator("main .ProseMirror .is-cited")).toHaveText("Second paragraph about the harbour.");
});
