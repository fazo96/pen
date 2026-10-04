import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  AUTH_FILE,
  isAuthorized,
  isLocked,
  issueSession,
  removePassword,
  safeNext,
  SESSION_MAX_AGE_S,
  setPassword,
  takeAttempt,
  verifyPassword,
} from "../lib/auth.ts";

// The optional lock (lib/auth.ts), on the scratch library. One test, in order:
// they share the auth file.

test("the lock: passwords, sessions, and a corrupt auth file", async () => {
  // Open: everything is allowed, and there's no password to match.
  assert.equal(await isLocked(), false);
  assert.equal(await isAuthorized(undefined), true);
  assert.equal(await verifyPassword("anything"), false);
  await assert.rejects(issueSession(), /not locked/);

  await setPassword("correct horse");
  assert.equal(await isLocked(), true);
  assert.equal((await stat(AUTH_FILE)).mode & 0o777, 0o600);
  assert.equal(await verifyPassword("correct horse"), true);
  assert.equal(await verifyPassword("correct horsE"), false);
  // Normalized (NFKC), so the same password typed on another keyboard matches.
  await setPassword("ﬁsh and chips");
  assert.equal(await verifyPassword("fish and chips"), true);

  const token = await issueSession();
  const [expires, mac] = token.split(".");
  assert.ok(Math.abs(Number(expires) - (Date.now() + SESSION_MAX_AGE_S * 1000)) < 5000);
  assert.equal(await isAuthorized(token), true);
  assert.equal(await isAuthorized(undefined), false);
  assert.equal(await isAuthorized(""), false);
  assert.equal(await isAuthorized("garbage"), false);
  assert.equal(await isAuthorized(`${expires}.${mac.slice(0, -1)}x`), false);
  assert.equal(await isAuthorized(`${Number(expires) + 1}.${mac}`), false); // the expiry is signed
  assert.equal(await isAuthorized(`${Date.now() - 1}.${mac}`), false);

  // A new password ends every session.
  await setPassword("fish and chips");
  assert.equal(await isAuthorized(token), false);
  assert.equal(await isAuthorized(await issueSession()), true);

  // A corrupt file must not unlock the instance.
  const good = await readFile(AUTH_FILE, "utf8");
  await writeFile(AUTH_FILE, "{ not json");
  await assert.rejects(isAuthorized(undefined));
  await writeFile(AUTH_FILE, JSON.stringify({ v: 1, salt: "", hash: "", secret: "" }));
  await assert.rejects(isLocked(), /bad auth file/);
  await writeFile(AUTH_FILE, good);

  await removePassword();
  await removePassword(); // already gone: fine
  assert.equal(await isLocked(), false);
  assert.equal(await isAuthorized("garbage"), true);
});

test("safeNext keeps people on this site", () => {
  assert.equal(safeNext("/d/book?x=1"), "/d/book?x=1");
  assert.equal(safeNext("/"), "/");
  for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "d/book"]) {
    assert.equal(safeNext(bad), "/", String(bad));
  }
});

test("takeAttempt allows 30 password checks a minute", () => {
  let allowed = 0;
  for (let i = 0; i < 40; i++) if (takeAttempt()) allowed++;
  assert.equal(allowed, 30);
});
