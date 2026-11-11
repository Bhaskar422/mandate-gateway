import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  if (req.cookies.get("mandate_uid")) return NextResponse.next();
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = `usr_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  // Make the cookie visible to this same request's server components too.
  const headers = new Headers(req.headers);
  headers.set("cookie", [req.headers.get("cookie"), `mandate_uid=${id}`].filter(Boolean).join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("mandate_uid", id, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}
export const config = { matcher: ["/", "/purchases/:path*", "/activity", "/mandates", "/agents", "/merchants", "/settings", "/assistant", "/for-merchants", "/api/paypal/:path*", "/api/activity", "/api/assistant"] };
