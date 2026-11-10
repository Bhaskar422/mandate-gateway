// Mint a fresh key for the user who owns the agent with the given key prefix, and put it in Claude Desktop's config.
// Usage: DATABASE_URL=<db> tsx --env-file=.env.local scripts/connect-desktop.ts <key prefix> [gateway base URL]
// Only the hash of a key is stored, so an existing key cannot be read back.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { activeMandate, committedSpend, createAgent } from "../src/lib/gateway";

async function main() {
  const prefix = process.argv[2];
  const [a] = await db.select().from(schema.agents).where(eq(schema.agents.keyPrefix, prefix));
  if (!a) throw new Error("No agent with key prefix " + prefix);
  const [link] = await db.select().from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, a.userId));
  const m = await activeMandate(a.userId);
  const spend = m ? await committedSpend(db, m.id) : null;
  const left = m && spend ? ((m.rules.totalLimitCents - spend.committedCents) / 100).toFixed(2) : null;
  const kind = link?.vaultId?.startsWith("SIM-") ? "simulated" : "real";
  console.log("user found. paypal: " + (link?.status ?? "not linked") + " (" + kind + ") | mandate: " + (m ? "active, $" + left + " left" : "none"));

  const { key, agent } = await createAgent(a.userId, "Claude Desktop");
  const p = homedir() + "/Library/Application Support/Claude/claude_desktop_config.json";
  const d = JSON.parse(readFileSync(p, "utf8"));
  // Optional second argument: the gateway's base URL. Points all three servers at it.
  const host = (process.argv[3] ?? "").replace(/\/$/, "");
  if (host) {
    const paths: Record<string, string> = { mandate: "/api/mcp", "stride-store": "/stores/stride/mcp", "kickz-store": "/stores/kickz/mcp" };
    for (const [name, path] of Object.entries(paths)) {
      const a: string[] | undefined = d.mcpServers[name]?.args;
      const j = a ? a.findIndex((x) => /^https?:\/\//.test(x)) : -1;
      if (a && j >= 0) a[j] = host + path;
    }
  }
  const args: string[] = d.mcpServers.mandate.args;
  const i = args.findIndex((x) => x.startsWith("Authorization: Bearer "));
  if (i < 0) throw new Error("The mandate server in the config has no Authorization header");
  args[i] = "Authorization: Bearer " + key;
  writeFileSync(p, JSON.stringify(d, null, 2));
  console.log("config updated with new key " + agent.keyPrefix + "… (agent \"Claude Desktop\")");
  process.exit(0);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
