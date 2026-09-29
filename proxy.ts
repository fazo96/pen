import { type NextRequest, NextResponse } from "next/server";
import { isAuthorized, SESSION_COOKIE } from "@/lib/auth";

// When a password is set, everything except the unlock screen and its API
// needs a session. Route handlers and pages check again on their own.
export async function proxy(req: NextRequest) {
  if (await isAuthorized(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|unlock(?:$|/)|api/auth(?:$|/)|favicon\\.ico$).*)"],
};
