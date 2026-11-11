import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, schema } from "./db";

export const SESSION_COOKIE = "mandate_uid";
export const sessionCookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, maxAge: 60 * 60 * 24 * 365, path: "/" });
/** The cookie is an unguessable id set by middleware. The user row is created on first use. */
export async function currentUserId(): Promise<string> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id || !/^usr_[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error("No session");
  await db.insert(schema.users).values({ id }).onConflictDoNothing();
  return id;
}

/** A fresh anonymous session id, in the same shape the middleware issues. */
export const newSessionId = () => `usr_${randomBytes(18).toString("base64url")}`;
