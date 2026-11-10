import { currentUserId } from "@/lib/session";
import { dashboardState } from "@/lib/views";
export const dynamic = "force-dynamic";
export const GET = async () => Response.json(await dashboardState(await currentUserId()));
