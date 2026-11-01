import { expect, type Page, test } from "@playwright/test";
import { command, type EditorElement, makeBook, openBook, response, uniqueId } from "./helpers";

// Cadence: the sound of the paragraph at the cursor, beside the manuscript on
// a wide screen and in the drawer on a narrow one. The server's dictionary is
// tests/fixtures/cmudict-mini.dict (playwright.config.ts).

const BODY = "The river ran beneath the broken stone. Kvothe fell.";

/** The cursor into the book's paragraph, once the editor has taken it (a key pressed right after a click can beat it). */
async function cursorInText(page: Page) {
  await page.locator("main .ProseMirror p").first().click();
  await expect
    .poll(() => page.evaluate(() => (document.querySelector("main .ProseMirror") as EditorElement).editor.state.selection.$from.parent.type.name))
    .toBe("paragraph");
}

test("Cadence reads the paragraph at the cursor, beside the manuscript", async ({ page, request }) => {
  const id = await makeBook(request, uniqueId("cadence"), BODY);
  await openBook(page, id);
  await cursorInText(page);

  await page.getByRole("button", { name: "Cadence", exact: true }).click();
  const panel = page.locator(".cadence-panel");
  await expect(panel).toBeVisible();
  const river = panel.locator(".cad-word", { has: page.getByRole("button", { name: "river", exact: true }) });
  await expect(river.locator(".cad-mark")).toHaveText(["/", "x"]);
  await expect(panel.locator(".cadence-section").first()).toContainText("iambic, 5 feet");
  await expect(panel.locator(".cadence-section", { hasText: "Sentences" })).toContainText("lands on a stress");

  // A tap tries another stress, for this reading only.
  await river.locator(".cad-mark").first().click();
  await expect(river.locator(".cad-mark")).toHaveText(["x", "x"]);
  await expect(panel.locator(".cadence-section").first()).not.toContainText("5 feet");
  await panel.getByRole("button", { name: "Undo what-ifs" }).click();
  await expect(river.locator(".cad-mark")).toHaveText(["/", "x"]);

  // A word it doesn't know, said the writer's way.
  await panel.locator(".cadence-unknown").getByRole("button", { name: "Kvothe" }).click();
  await expect(panel.locator(".cadence-word")).toContainText("Not in the dictionary");
  await panel.getByLabel("Sounds like (English words, optional)").fill("quoth");
  const saved = response(page, "PATCH", /\/api\/prosody$/);
  await panel.getByRole("button", { name: "Save, for every book" }).click();
  expect((await saved).status()).toBe(200);
  await expect(panel.locator(".cad-word.is-yours")).toContainText("Kvothe");
  await expect(panel.locator(".cadence-ipa")).toHaveText("/kwoʊθ/");
  await request.patch("/api/prosody", { data: { remove: "kvothe" } });

  // It opens again on a reload, and gives the slot up to a Codex entry.
  await page.reload();
  await expect(page.locator(".cadence-panel")).toBeVisible();
  await command(page, "New Codex entry");
  await expect(page.locator(".codex-panel:not(.cadence-panel)")).toBeVisible();
  await expect(page.locator(".cadence-panel")).toHaveCount(0);
});

test("on a narrow screen Cadence is the drawer's tab", async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const id = await makeBook(request, uniqueId("cadence-narrow"), BODY);
  await openBook(page, id);
  await cursorInText(page);
  await command(page, "Show Cadence");
  const drawer = page.locator(".cadence");
  await expect(drawer).toBeVisible();
  await expect(page.locator(".cadence-panel")).toHaveCount(0);
  await expect(drawer.locator(".cad-word")).toHaveCount(9);
});
