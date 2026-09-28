import { db } from "@/lib/db/client";
import { listSessions } from "@/lib/db/queries";
import { Nav } from "./_components/nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessions = await listSessions(db);

  return (
    <div className="min-h-screen bg-white">
      <Nav sessions={sessions} />
      <main className="pb-24">{children}</main>
    </div>
  );
}
