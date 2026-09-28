import { Nav } from "./_components/nav";

// resetDemo() (triggered from the nav on every page here) regenerates and
// uploads all 160 invoice PDFs, which takes ~20s — past the 10s default.
// Raises the ceiling where the Vercel plan allows it; on a plan that caps
// lower regardless, the PDF route's render-on-demand fallback covers any
// invoice this doesn't get to.
export const maxDuration = 60;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main className="pb-24">{children}</main>
    </div>
  );
}
