import { expect, test } from "@playwright/test";
import { uniqueId } from "./helpers";

// Every API route answers as it should: what lib/route.ts checks (ids, the
// session), each route's validation, and the happy paths. No browser needed.

test("books: create, read, save, conflict, rename, trash", async ({ request }) => {
  const id = uniqueId("api-book");
  expect((await request.post("/api/docs", { data: { content: "# A\n\ntext", name: id } })).status()).toBe(201);
  expect((await request.post("/api/docs", { data: Buffer.from("not json"), headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  expect((await request.post("/api/docs", { data: { content: 5 } })).status()).toBe(400);
  expect((await request.get("/api/docs")).status()).toBe(200);

  const doc = await request.get(`/api/docs/${id}`);
  expect(doc.status()).toBe(200);
  const { version } = (await doc.json()) as { version: string };
  expect((await request.get("/api/docs/no-such-book")).status()).toBe(404);
  expect((await request.get("/api/docs/BAD_ID")).status()).toBe(404);

  expect((await request.put(`/api/docs/${id}`, { data: { content: "# A\n\nmore", baseVersion: version } })).status()).toBe(200);
  const stale = await request.put(`/api/docs/${id}`, { data: { content: "# A\n\nstale", baseVersion: "000000000000" } });
  expect(stale.status()).toBe(409);
  expect(((await stale.json()) as { content: string }).content).toBe("# A\n\nmore");
  // The beacon's POST, forced.
  expect((await request.post(`/api/docs/${id}`, { data: { content: "# A\n\nforced", baseVersion: null, force: true } })).status()).toBe(200);
  expect((await request.put(`/api/docs/${id}`, { data: { nocontent: 1 } })).status()).toBe(400);

  const other = uniqueId("api-other");
  await request.post("/api/docs", { data: { content: "# B", name: other } });
  expect((await request.patch(`/api/docs/${id}`, { data: { id: "BAD" } })).status()).toBe(400);
  expect((await request.patch(`/api/docs/${id}`, { data: { id: other } })).status()).toBe(409);
  const renamed = `${id}-x`;
  expect((await request.patch(`/api/docs/${id}`, { data: { id: renamed } })).status()).toBe(200);
  expect((await request.get(`/api/docs/${renamed}`)).status()).toBe(200);
  // An editor still open under the old id keeps working (proxy.ts, .pen-renames.json).
  const old = await request.get(`/api/docs/${id}`);
  expect(old.status()).toBe(200);
  expect(((await old.json()) as { content: string }).content).toBe("# A\n\nforced");

  expect((await request.delete(`/api/docs/${renamed}`)).status()).toBe(204);
  expect((await request.delete(`/api/docs/${renamed}`)).status()).toBe(404);
  await request.delete(`/api/docs/${other}`);
});

test("versions: save, import, read, rename, restore, delete", async ({ request }) => {
  const id = uniqueId("api-versions");
  await request.post("/api/docs", { data: { content: "# A\n\ntext", name: id } });
  const base = `/api/docs/${id}/versions`;
  expect((await request.get(base)).status()).toBe(200);
  expect((await request.post(base, { data: { label: "First" } })).status()).toBe(201);
  expect((await request.post(base)).status()).toBe(201); // no body: an unnamed version
  expect((await request.post(base, { data: { label: "Old", content: "# A\n\nold", created: 1000 } })).status()).toBe(201);
  expect((await request.post(base, { data: { content: 7 } })).status()).toBe(400);

  const [{ id: vid }] = (await (await request.get(base)).json()) as { id: string }[];
  expect((await request.get(`${base}/${vid}`)).status()).toBe(200);
  expect((await request.get(`${base}/not-a-version`)).status()).toBe(404);
  expect((await request.patch(`${base}/${vid}`, { data: { label: "Renamed" } })).status()).toBe(200);
  expect((await request.patch(`${base}/${vid}`, { data: { label: 3 } })).status()).toBe(400);
  expect((await request.post(`${base}/${vid}/restore`)).status()).toBe(200);
  expect((await request.delete(`${base}/${vid}`)).status()).toBe(204);
  expect((await request.delete(`${base}/${vid}`)).status()).toBe(404);
  expect((await request.get(`/api/docs/no-such-book/versions`)).status()).toBe(404);
});

test("codex, spot, cover, export, imports", async ({ request }) => {
  const id = uniqueId("api-codex");
  await request.post("/api/docs", { data: { content: "# A\n\ntext", name: id } });
  const codex = `/api/docs/${id}/codex`;
  expect((await request.get(codex)).status()).toBe(200);
  const created = await request.post(codex, { data: { content: "# Mara Voss\n\nnote" } });
  expect(created.status()).toBe(201);
  const entry = ((await created.json()) as { id: string; version: string }).id;
  expect(entry).toBe("mara-voss");
  expect((await request.post(codex, { data: { html: "<html>not a crit page</html>" } })).status()).toBe(422);
  expect((await request.get(`/api/docs/no-such-book/codex`)).status()).toBe(404);
  expect((await request.get(`${codex}/${entry}`)).status()).toBe(200);
  expect((await request.get(`${codex}/Bad`)).status()).toBe(404);

  const { version } = (await (await request.get(`${codex}/${entry}`)).json()) as { version: string };
  expect((await request.put(`${codex}/${entry}`, { data: { content: "# Mara Voss\n\nedited", baseVersion: version } })).status()).toBe(200);
  expect((await request.put(`${codex}/${entry}`, { data: { content: "x", baseVersion: "000000000000" } })).status()).toBe(409);

  expect((await request.put(`/api/docs/${id}/spot`, { data: { entry } })).status()).toBe(204);
  expect((await request.put(`/api/docs/${id}/spot`, { data: {} })).status()).toBe(400);
  expect((await request.put(`/api/docs/${id}/spot`, { data: { entry: "BAD" } })).status()).toBe(404);

  expect((await request.delete(`${codex}/${entry}`)).status()).toBe(204);
  expect((await request.delete(`${codex}/${entry}`)).status()).toBe(404);

  expect((await request.get(`/api/docs/${id}/cover`)).status()).toBe(404);
  expect((await request.put(`/api/docs/${id}/cover`, { data: Buffer.from("not an image") })).status()).toBe(415);
  expect((await request.delete(`/api/docs/${id}/cover`)).status()).toBe(404);

  expect((await request.get(`/api/docs/${id}/export`)).headers()["content-type"]).toContain("zip");
  expect((await request.get(`/api/export`)).status()).toBe(200);

  expect((await request.get(`/api/docs/${id}/imports`)).status()).toBe(200);
  expect((await request.get(`/api/docs/${id}/imports/no-job`)).status()).toBe(404);
  expect((await request.delete(`/api/docs/${id}/imports/no-job`)).status()).toBe(404);
  expect((await request.get(`/api/docs/${id}/imports/no-job/0`)).status()).toBe(404);
});

test("the Global Codex (_global): its entries, spot and moves; no book routes", async ({ request }) => {
  const codex = "/api/docs/_global/codex";
  const name = uniqueId("api-global");
  const created = await request.post(codex, { data: { content: `# ${name}\n\nshared` } });
  expect(created.status()).toBe(201);
  const { id: entry } = (await created.json()) as { id: string };
  expect(((await (await request.get(codex)).json()) as { id: string }[]).some((e) => e.id === entry)).toBe(true);
  const { version } = (await (await request.get(`${codex}/${entry}`)).json()) as { version: string };
  expect((await request.put(`${codex}/${entry}`, { data: { content: `# ${name}\n\nedited`, baseVersion: version } })).status()).toBe(200);
  expect((await request.put("/api/docs/_global/spot", { data: { entry } })).status()).toBe(204);
  expect((await request.post(codex, { data: { images: ["aGk="] } })).status()).toBe(400); // notes go into a book

  // Into a book and back.
  const book = uniqueId("api-global-book");
  expect((await request.post("/api/docs", { data: { content: `# ${book}\n\nText.`, name: book } })).status()).toBe(201);
  const toBook = await request.post(`${codex}/${entry}/move`, { data: { to: book } });
  expect(toBook.status()).toBe(200);
  expect(((await toBook.json()) as { id: string }).id).toBe(entry);
  expect((await request.get(`${codex}/${entry}`)).status()).toBe(404);
  expect((await request.get(`/api/docs/${book}/codex/${entry}`)).status()).toBe(200);
  expect((await request.post(`/api/docs/${book}/codex/${entry}/move`, { data: { to: "_global" } })).status()).toBe(200);
  expect((await request.post(`${codex}/${entry}/move`, { data: { to: "_global" } })).status()).toBe(400);
  expect((await request.post(`${codex}/${entry}/move`, { data: { to: "no-such-book" } })).status()).toBe(404);
  expect((await request.post(`${codex}/${entry}/move`, { data: { to: "../x" } })).status()).toBe(400);
  expect((await request.delete(`${codex}/${entry}`)).status()).toBe(204);

  // It's no book.
  expect((await request.get("/api/docs/_global")).status()).toBe(404);
  expect((await request.put("/api/docs/_global", { data: { content: "# x" } })).status()).toBe(404);
  expect((await request.get("/api/docs/_global/versions")).status()).toBe(404);
  expect((await request.get("/api/docs/_global/export")).status()).toBe(404);
  expect((await request.get("/api/docs/_global/imports")).status()).toBe(404);
  expect((await request.get("/api/docs/_other/codex")).status()).toBe(404);
});

test("AI routes work, on the stub agent", async ({ request }) => {
  const id = uniqueId("api-ai");
  await request.post("/api/docs", { data: { content: "# A", name: id } });
  const models = await request.get(`/api/construct/models`);
  expect(models.status()).toBe(200);
  expect(((await models.json()) as { agent: string }[]).map((a) => a.agent)).toEqual(["claude"]);
  const quick = await request.post(`/api/docs/${id}/construct/quick`, { data: { text: "hi there" } });
  expect(quick.status()).toBe(200);
  expect(await quick.text()).toContain("Echo:");
  expect((await request.post(`/api/docs/${id}/construct/quick`, { data: { text: "" } })).status()).toBe(400);
  expect((await request.post(`/api/docs/${id}/construct`, { data: { action: "start" } })).status()).toBe(204);
  expect((await request.post(`/api/docs/${id}/construct`, { data: { action: "nope" } })).status()).toBe(400);
  expect((await request.post(`/api/docs/${id}/codex`, { data: { images: ["aGk="] } })).status()).toBe(415); // not a picture
  // The Global Codex has a Construct of its own, and quick answers.
  expect((await request.post("/api/docs/_global/construct", { data: { action: "start" } })).status()).toBe(204);
  const globalQuick = await request.post("/api/docs/_global/construct/quick", { data: { text: "hi there" } });
  expect(globalQuick.status()).toBe(200);
  expect(await globalQuick.text()).toContain("Echo:");
  // Construct's MCP endpoint wants its own bearer token, not the session.
  expect((await request.post(`/api/construct/mcp`, { data: {} })).status()).toBe(401);
});

test("library-wide settings: Construct, grammar, dictionary, shelves", async ({ request }) => {
  expect((await request.get("/api/construct/settings")).status()).toBe(200);
  expect((await request.patch("/api/construct/settings", { data: {} })).status()).toBe(200);
  expect((await request.patch("/api/construct/settings", { data: Buffer.from("x"), headers: { "Content-Type": "application/json" } })).status()).toBe(400);

  expect((await request.get("/api/grammar")).status()).toBe(200);
  expect((await request.patch("/api/grammar", { data: Buffer.from("x"), headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  expect((await request.patch("/api/grammar", { data: { addWord: "Marabel" } })).status()).toBe(200);
  expect((await request.post("/api/grammar/check", { data: { nope: 1 } })).status()).toBe(400);
  const check = await request.post("/api/grammar/check", { data: { texts: ["The cat sat on teh mat."] } });
  expect(check.status()).toBe(200);
  expect(((await check.json()) as { flags: unknown[][] }).flags[0].length).toBeGreaterThan(0);

  expect((await request.get("/api/dictionary?word=")).status()).toBe(400);
  expect((await request.put("/api/shelves", { data: Buffer.from("x"), headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  expect((await request.get("/api/auth")).status()).toBe(200);
});

test("a stale page saving the shelves keeps a renamed book in its place", async ({ request }) => {
  const [a, b] = [uniqueId("api-shelf-a"), uniqueId("api-shelf-b")];
  for (const name of [a, b]) await request.post("/api/docs", { data: { content: "# x", name } });
  const shelves = (books: string[][]) => ({
    shelves: books.map((list, i) => ({ id: `s${i}`, name: `Shelf ${i}`, books: list })),
  });
  expect((await request.put("/api/shelves", { data: shelves([[a], [b]]) })).status()).toBe(200);
  const renamed = `${b}-new`;
  await request.patch(`/api/docs/${b}`, { data: { id: renamed } });
  // A page opened before the rename still says `b`.
  const saved = await request.put("/api/shelves", { data: shelves([[a], [b]]) });
  const layout = (await saved.json()) as { shelves: { books: string[] }[] };
  expect(layout.shelves[1].books).toEqual([renamed]);
});

test("writing stats: saves are counted, pasted words and forced saves aren't", async ({ request }) => {
  const id = uniqueId("api-stats");
  await request.post("/api/docs", { data: { content: "# Stats\n\nOne.", name: id } });
  const save = (content: string, extra: object = {}) =>
    request.put(`/api/docs/${id}`, { data: { content, baseVersion: null, ...extra } });
  expect((await save("# Stats\n\nOne.\n\nFour words typed here.")).status()).toBe(200);
  expect((await save("# Stats\n\nOne.\n\nFour words typed here.\n\nThree pasted words.", { pasted: 3 })).status()).toBe(200);
  expect((await save("# Stats\n\nForced.", { force: true })).status()).toBe(200);

  // Recorded in the background, after the save answers.
  await expect(async () => {
    const res = await request.get("/api/stats");
    expect(res.status()).toBe(200);
    const report = (await res.json()) as { slots: { book: string; drafted: number; pasted: number; saves: number }[]; books: Record<string, { title: string }> };
    const mine = report.slots.filter((s) => s.book === id);
    expect(mine.map((s) => [s.drafted, s.pasted, s.saves])).toEqual([[4, 3, 2]]);
    expect(report.books[id].title).toBe("Stats");
  }).toPass();

  expect((await request.get("/api/stats?from=5&to=1")).status()).toBe(400);
  expect((await request.get("/api/stats?from=nope")).status()).toBe(400);
  await request.delete(`/api/docs/${id}`);
});
