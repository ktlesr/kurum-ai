import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Chat from "./chat";
import { Presence } from "./presence";

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.mustChange) redirect("/hesap");
  return (
    <>
      <Presence />
      <Chat username={user.username} isAdmin={user.role === "admin"} />
    </>
  );
}
