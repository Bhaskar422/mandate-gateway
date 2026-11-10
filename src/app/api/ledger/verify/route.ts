import { verifyChain } from "@/lib/ledger";
export const dynamic = "force-dynamic";
export const GET = async () => Response.json(await verifyChain());
