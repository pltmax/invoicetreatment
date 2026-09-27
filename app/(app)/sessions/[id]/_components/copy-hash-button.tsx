"use client";

import { useState } from "react";

export function CopyHashButton({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="no-print text-sm text-blue-600 underline"
      onClick={async () => {
        await navigator.clipboard.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copié" : "Copier"}
    </button>
  );
}
