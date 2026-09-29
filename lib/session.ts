import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthorized, SESSION_COOKIE } from "./auth";

/** Session check for route handlers and pages (the proxy is the first line, this the second). */
export async function hasSession(): Promise<boolean> {
  return isAuthorized((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requirePageSession(next: string): Promise<void> {
  if (!(await hasSession())) redirect(`/unlock?next=${encodeURIComponent(next)}`);
}

export const lockedResponse = () => Response.json({ error: "locked" }, { status: 401 });
