import { type NextRequest, NextResponse } from "next/server";
import { isAuthorized, SESSION_COOKIE } from "@/lib/auth";
import { renamedTo } from "@/lib/renames";

// When a password is set, everything except the unlock screen and its API
// needs a session. Route handlers and pages check again on their own.
export async function proxy(req: NextRequest) {
  // pen has no Server Actions, so a request naming one is a scanner probing for
  // RSC exploits. Turn it away before Next tries to decode it (and logs an error).
  if (req.headers.has("next-action")) return new NextResponse(null, { status: 404 });

  const { pathname, search } = req.nextUrl;
  if (pathname === "/unlock") return NextResponse.next(); // matched only for the check above
  if (await isAuthorized(req.cookies.get(SESSION_COOKIE)?.value)) return followRename(req);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

// A renamed book's old id: pages redirect to the new one; API calls (an
// editor still open under the old id, saving) go to it without a round trip,
// rather than recreating the old project.
const PROJECT_PATH = /^\/(d|api\/docs)\/([^/]+)(\/.*)?$/;
async function followRename(req: NextRequest) {
  const m = PROJECT_PATH.exec(req.nextUrl.pathname);
  const to = m && (await renamedTo(m[2]));
  if (!m || !to) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/${m[1]}/${to}${m[3] ?? ""}`;
  return m[1] === "d" ? NextResponse.redirect(url) : NextResponse.rewrite(url);
}

export const config = {
  // api/construct/mcp is called by the Construct agent process, with its own token.
  // The manifest is fetched without cookies, so it and the icons stay public.
  matcher: [
    "/unlock",
    "/((?!_next/|unlock(?:$|/)|api/auth(?:$|/)|api/construct/mcp$|favicon\\.ico$|icon\\.svg$|icon-[a-z0-9-]+\\.png$|apple-icon\\.png$|manifest\\.webmanifest$).*)",
  ],
};
