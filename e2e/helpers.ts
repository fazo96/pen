import { type APIRequestContext, expect, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

// Shared steps for the browser tests. Each test makes its own books (ids are
// unique per test), since the whole run shares one library.

/** The editor's element: pen exposes its Tiptap instance on it for tests. */
export type EditorElement = HTMLElement & { editor: Editor };

let n = 0;
/** A fresh book id for this test run. */
export const uniqueId = (base: string) => `${base}-${Date.now().toString(36)}-${n++}`;

/** Create a book through the API; its id. */
export async function makeBook(request: APIRequestContext, name: string, body = "The rain fell at last."): Promise<string> {
  const res = await request.post("/api/docs", { data: { content: `# ${name}\n\n${body}\n`, name } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Open a book's editor and wait for the text. */
export async function openBook(page: Page, id: string) {
  await page.goto(`/d/${id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

/** Run a command from the palette (Ctrl+P), by its label. */
export async function command(page: Page, label: string) {
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("dialog", { name: "Commands" }).getByRole("combobox")).toBeVisible();
  await page.keyboard.type(label);
  await page.keyboard.press("Enter");
}

/** Resolves with the first response to `method` on a path matching `path`. */
export const response = (page: Page, method: string, path: RegExp) =>
  page.waitForResponse((r) => r.request().method() === method && path.test(new URL(r.url()).pathname));
