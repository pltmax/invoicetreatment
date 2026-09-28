"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resetDemo } from "@/app/actions/demo";
import type { SessionSummaryRow } from "@/lib/db/queries";

const LINKS = [
  {
    href: "/",
    label: "Tableau de bord",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"
      />
    ),
  },
  {
    href: "/inbox",
    label: "Boîte de réception",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8.5 12 14l9-5.5M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"
      />
    ),
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 9a6 6 0 1 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6ZM10 19a2 2 0 0 0 4 0"
      />
    ),
  },
  {
    href: "/rules",
    label: "Règles",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h10M4 12h16M4 17h7"
      />
    ),
  },
  {
    href: "/extraction",
    label: "Couche d'extraction",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
      />
    ),
  },
];

const SESSIONS_ICON = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d="M12 7v5l3 3M12 3a9 9 0 1 0 9 9"
  />
);

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function formatSignedAt(signedAt: string): string {
  const date = new Date(signedAt);
  if (Number.isNaN(date.getTime())) return signedAt;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function SessionsMenu({ sessions }: { sessions: SessionSummaryRow[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = pathname.startsWith("/sessions");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded px-2 text-sm font-medium sm:justify-start sm:px-3 ${
          isActive ? "text-blue-600" : "text-gray-600"
        }`}
      >
        <Icon>{SESSIONS_ICON}</Icon>
        <span className="hidden sm:inline">Sessions précédentes</span>
        <span className="sr-only sm:hidden">Sessions précédentes</span>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 max-h-96 w-72 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
          {sessions.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">Aucune session pour le moment.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{formatSignedAt(session.signedAt)}</span>
                    <span className="text-gray-500">
                      {session.kind === "batch" ? "Lot" : "Individuelle"} · {session.decisionCount} facture
                      {session.decisionCount === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Nav({ sessions }: { sessions: SessionSummaryRow[] }) {
  const pathname = usePathname();

  return (
    <header className="no-print flex items-center justify-between gap-2 border-b border-gray-200 px-2 py-2 sm:px-4 sm:py-3">
      <Link href="/" className="hidden shrink-0 text-base font-semibold text-gray-900 sm:inline">
        Traitement des factures
      </Link>
      <nav aria-label="Navigation principale">
        <ul className="flex items-center gap-1 sm:gap-4">
          {LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded px-2 text-sm font-medium sm:justify-start sm:px-3 ${
                    isActive ? "text-blue-600" : "text-gray-600"
                  }`}
                >
                  <Icon>{link.icon}</Icon>
                  <span className="hidden sm:inline">{link.label}</span>
                  <span className="sr-only sm:hidden">{link.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <SessionsMenu sessions={sessions} />
          </li>
        </ul>
      </nav>
      <form action={resetDemo}>
        <button
          type="submit"
          aria-label="Réinitialiser la démo"
          title="Réinitialiser la démo"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-gray-500"
        >
          <Icon>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l2.5 1.5M12 4a8 8 0 1 1-6.32 3.09M5 4v4h4"
            />
          </Icon>
        </button>
      </form>
    </header>
  );
}
