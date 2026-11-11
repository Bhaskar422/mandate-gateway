import type { Metadata } from "next";
import Chat from "@/components/assistant/Chat";

export const metadata: Metadata = { title: "Shopping assistant" };

export default function AssistantPage() {
  return <Chat />;
}
