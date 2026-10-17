import { NextResponse } from "next/server";
import { withRole } from "@/lib/api";
import { listConversations } from "@/lib/conversations";

export async function GET() {
  return withRole(["kid", "admin"], async () => NextResponse.json({ conversations: await listConversations() }));
}
