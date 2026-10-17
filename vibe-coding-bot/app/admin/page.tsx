import { redirect } from "next/navigation";
import { AdminApp } from "@/components/AdminApp";
import { getSession } from "@/lib/session";

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/");
  return <AdminApp />;
}
