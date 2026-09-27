"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
    >
      Imprimer
    </button>
  );
}
