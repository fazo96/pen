import type { NextRequest } from "next/server";
import {
  isLocked,
  issueSession,
  MIN_PASSWORD,
  takeAttempt,
  removePassword,
  SESSION_COOKIE,
  sessionCookie,
  setPassword,
  verifyPassword,
} from "@/lib/auth";
import { hasSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const FAIL_DELAY_MS = 1000;

type Body = { action?: unknown; password?: unknown; current?: unknown };

const json = (body: unknown, status = 200) => Response.json(body, { status });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isHttps(req: NextRequest) {
  return req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

/** Check a password; failures are slowed down and capped. */
async function checkPassword(password: unknown): Promise<Response | null> {
  if (!takeAttempt()) return json({ error: "Too many attempts. Wait a minute." }, 429);
  if (typeof password === "string" && (await verifyPassword(password))) return null;
  await sleep(FAIL_DELAY_MS);
  return json({ error: "Wrong password." }, 403);
}

function withSession(res: Response, token: string, req: NextRequest) {
  const c = sessionCookie(token, isHttps(req));
  res.headers.append(
    "Set-Cookie",
    `${c.name}=${c.value}; Path=${c.path}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}`,
  );
  return res;
}

function clearSession(res: Response) {
  res.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return res;
}

function validNew(password: unknown): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD && password.length <= 256;
}

export async function GET() {
  return json({ locked: await isLocked(), authorized: await hasSession() });
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const locked = await isLocked();

  switch (body.action) {
    case "unlock": {
      if (!locked) return json({ ok: true });
      const fail = await checkPassword(body.password);
      if (fail) return fail;
      return withSession(json({ ok: true }), await issueSession(), req);
    }

    case "set": {
      // First lock only; changing an existing password goes through "change".
      if (locked) return json({ error: "Already locked." }, 409);
      if (!validNew(body.password)) return json({ error: `Use at least ${MIN_PASSWORD} characters.` }, 400);
      await setPassword(body.password);
      return withSession(json({ ok: true }), await issueSession(), req);
    }

    case "change": {
      if (!locked) return json({ error: "Not locked." }, 409);
      if (!(await hasSession())) return json({ error: "locked" }, 401);
      const fail = await checkPassword(body.current);
      if (fail) return fail;
      if (!validNew(body.password)) return json({ error: `Use at least ${MIN_PASSWORD} characters.` }, 400);
      await setPassword(body.password); // new secret: every other device is signed out
      return withSession(json({ ok: true }), await issueSession(), req);
    }

    case "remove": {
      if (!locked) return json({ ok: true });
      if (!(await hasSession())) return json({ error: "locked" }, 401);
      const fail = await checkPassword(body.current);
      if (fail) return fail;
      await removePassword();
      return clearSession(json({ ok: true }));
    }

    case "signout":
      return clearSession(json({ ok: true }));

    default:
      return json({ error: "unknown action" }, 400);
  }
}
