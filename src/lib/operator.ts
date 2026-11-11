// The gateway's operator: whoever runs this deployment. One shared key (OPERATOR_KEY) opens the review page, where
// stores are granted or refused "verified" status. Users and merchants never see this.
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { appUrl } from "./config";

const COOKIE = "mandate_operator";
export const operatorConfigured = () => (process.env.OPERATOR_KEY ?? "").length >= 16;
const digest = (s: string) => createHash("sha256").update(`mandate-operator:${s}`).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export async function isOperator() {
  if (!operatorConfigured()) return false;
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && same(Buffer.from(c, "hex"), digest(process.env.OPERATOR_KEY!));
}
export async function requireOperator() { if (!(await isOperator())) throw new Error("Operator sign-in required"); }

export async function operatorSignIn(key: string) {
  if (!operatorConfigured()) throw new Error("No operator key is configured on this deployment (set OPERATOR_KEY, at least 16 characters)");
  if (!same(digest(key.trim()), digest(process.env.OPERATOR_KEY!))) throw new Error("That is not the operator key");
  (await cookies()).set(COOKIE, digest(process.env.OPERATOR_KEY!).toString("hex"), { httpOnly: true, sameSite: "strict", secure: appUrl().startsWith("https:"), maxAge: 60 * 60 * 8, path: "/" });
}
export async function operatorSignOut() { (await cookies()).delete(COOKIE); }
