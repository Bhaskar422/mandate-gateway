import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export async function getUser(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return u ?? null;
}
