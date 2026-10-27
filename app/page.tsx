import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Chat from "./chat";

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <Chat username={user.username} isAdmin={user.role === "admin"} />;
}
