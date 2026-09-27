import Link from "next/link";
import { resetDemo } from "@/app/actions/demo";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="no-print flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <Link href="/" className="text-base font-semibold text-gray-900">
          Approbation des factures
        </Link>
        <form action={resetDemo}>
          <button type="submit" className="text-sm text-gray-500 underline">
            Réinitialiser
          </button>
        </form>
      </header>
      <main className="pb-24">{children}</main>
    </div>
  );
}
