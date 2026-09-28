"use client";

import { useState } from "react";

// Matches this app's existing `sm:` Tailwind breakpoint (640px), used
// elsewhere for the same mobile/desktop split.
const DESKTOP_BREAKPOINT_PX = 640;

export function ViewPdfButton({ invoiceId, className = "" }: { invoiceId: string; className?: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  const href = `/api/invoices/${invoiceId}/pdf`;

  function handleClick() {
    if (window.innerWidth < DESKTOP_BREAKPOINT_PX) {
      setModalOpen(true);
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={className}>
        Voir le PDF
      </button>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 p-3">
            <span className="text-sm font-medium text-gray-900">Facture PDF</span>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-[44px] px-3 text-sm font-medium text-blue-600"
            >
              Fermer
            </button>
          </div>
          <iframe src={href} title="Facture PDF" className="flex-1" />
        </div>
      )}
    </>
  );
}
