import { redirect } from "next/navigation";
import { KidApp } from "@/components/KidApp";
import { getSession } from "@/lib/session";

export default async function ChatPage() {
  const session = await getSession();
  if (session?.role !== "kid") redirect("/");
  return <KidApp />;
}
