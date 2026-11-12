import { NextResponse, type NextRequest } from "next/server";

// The address the gateway was first deployed at. It keeps answering, so agents, stores and PayPal's webhooks that
// were set up with it go on working. People are sent to the current address (APP_URL), because a browser session
// belongs to one host and a flow that starts on one and returns on the other would lose it.
const LEGACY_HOST = "mandate-gateway.vercel.app";

/** Where a person who opened a page on the old address should be instead, or null to serve the request here. */
function moved(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  if (host !== LEGACY_HOST || (req.method !== "GET" && req.method !== "HEAD")) return null;
  let to: URL;
  try { to = new URL(process.env.APP_URL ?? ""); } catch { return null; }
  if (to.host === LEGACY_HOST) return null;
  const p = req.nextUrl.pathname;
  // Machines keep the old address: the APIs, the MCP servers, the well-known files, and anything that is a file.
  const forMachines = (p.startsWith("/api/") && !p.startsWith("/api/paypal/link")) || p.includes("/.well-known/")
    || /^\/stores\/[^/]+\/(api|mcp)(\/|$)/.test(p) || /\.[a-z0-9]+$/i.test(p);
  return forMachines ? null : NextResponse.redirect(new URL(`${p}${req.nextUrl.search}`, to), 307);
}

// The pages and routes that act for a visitor, and so need a session.
const NEEDS_SESSION = /^\/($|purchases(\/|$)|activity$|mandates$|agents$|merchants$|settings$|assistant$|for-merchants$|operator$|api\/paypal(\/|$)|api\/activity$|api\/assistant$)/;

export function middleware(req: NextRequest) {
  const elsewhere = moved(req);
  if (elsewhere) return elsewhere;
  if (!NEEDS_SESSION.test(req.nextUrl.pathname) || req.cookies.get("mandate_uid")) return NextResponse.next();
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = `usr_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  // Make the cookie visible to this same request's server components too.
  const headers = new Headers(req.headers);
  headers.set("cookie", [req.headers.get("cookie"), `mandate_uid=${id}`].filter(Boolean).join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("mandate_uid", id, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}
export const config = { matcher: ["/((?!_next/).*)"] };
