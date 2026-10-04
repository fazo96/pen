// Optional password lock for the whole instance.
//
// No "server-only" import: proxy.ts runs outside the RSC graph and needs this
// too. Nothing here is ever imported by client code.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "./files";
import { DOCS_DIR } from "./paths";

// Delete this file on the server to remove a forgotten password.
export const AUTH_FILE = path.join(DOCS_DIR, ".pen-auth.json");
export const SESSION_COOKIE = "pen_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;
export const MIN_PASSWORD = 8;

type AuthConfig = {
  v: 1;
  salt: string;
  hash: string;
  /** Signs session cookies. Replaced on every password change, which ends all sessions. */
  secret: string;
};

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function readAuth(): Promise<AuthConfig | null> {
  try {
    const cfg = JSON.parse(await readFile(AUTH_FILE, "utf8")) as AuthConfig;
    if (cfg.v !== 1 || !cfg.hash || !cfg.salt || !cfg.secret) throw new Error("bad auth file");
    return cfg;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A corrupt file must not silently unlock the instance.
    throw err;
  }
}

export async function isLocked(): Promise<boolean> {
  return (await readAuth()) !== null;
}

export async function verifyPassword(password: string): Promise<boolean> {
  const cfg = await readAuth();
  if (!cfg) return false;
  const key = await derive(password, cfg.salt);
  return timingSafeEqual(key, Buffer.from(cfg.hash, "hex"));
}

/** Set a new password (or the first one). Rotates the session secret. */
export async function setPassword(password: string): Promise<void> {
  const salt = randomBytes(16).toString("hex");
  const cfg: AuthConfig = {
    v: 1,
    salt,
    hash: (await derive(password, salt)).toString("hex"),
    secret: randomBytes(32).toString("hex"),
  };
  await writeAtomic(AUTH_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export async function removePassword(): Promise<void> {
  try {
    await unlink(AUTH_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function sign(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`pen-session:${payload}`).digest("base64url");
}

/** A session token is `<expiry ms>.<hmac>`; valid until expiry or the next password change. */
export async function issueSession(): Promise<string> {
  const cfg = await readAuth();
  if (!cfg) throw new Error("not locked");
  const expires = String(Date.now() + SESSION_MAX_AGE_S * 1000);
  return `${expires}.${sign(cfg.secret, expires)}`;
}

/** True when the instance is open, or the token is a valid session. */
export async function isAuthorized(token: string | undefined): Promise<boolean> {
  const cfg = await readAuth();
  if (!cfg) return true;
  if (!token) return false;
  const [expires, mac] = token.split(".");
  if (!expires || !mac || !(Number(expires) > Date.now())) return false;
  const want = Buffer.from(sign(cfg.secret, expires));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function sessionCookie(token: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}

/** Only same-site paths, so /unlock?next= can't bounce people elsewhere. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

// At most 30 password checks per minute, instance-wide. Counted before
// hashing so parallel requests can't all slip under the limit.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 30;
let attempts = { count: 0, since: 0 };

/** Claims one attempt; false when the limit is reached. */
export function takeAttempt(): boolean {
  const now = Date.now();
  if (now - attempts.since > WINDOW_MS) attempts = { count: 0, since: now };
  if (attempts.count >= MAX_ATTEMPTS) return false;
  attempts.count += 1;
  return true;
}
