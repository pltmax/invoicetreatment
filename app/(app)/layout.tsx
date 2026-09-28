import { Nav } from "./_components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main className="pb-24">{children}</main>
    </div>
  );
}
