import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  if (session?.role === "kid") redirect("/chat");
  if (session?.role === "admin") redirect("/admin");
  return <LoginForm />;
}
