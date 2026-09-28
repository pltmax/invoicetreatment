"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { extractInvoice } from "@/app/actions/extract-invoice";
import type { EntityRow } from "@/lib/db/queries";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-[44px] w-full rounded bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-8"
    >
      {pending ? "Extraction en cours…" : "Extraire la facture"}
    </button>
  );
}

export function UploadForm({ entities }: { entities: EntityRow[] }) {
  const [entityId, setEntityId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function acceptFile(file: File) {
    if (file.type !== "application/pdf") {
      setLocalError("Le fichier doit être un PDF.");
      setFileName(null);
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setLocalError("Le fichier dépasse 10 Mo.");
      setFileName(null);
      return;
    }
    setLocalError(null);
    setFileName(file.name);

    if (fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
  }

  return (
    <form action={extractInvoice} className="space-y-4">
      <div>
        <label htmlFor="entityId" className="mb-1 block text-sm font-medium text-gray-900">
          Filiale destinataire
        </label>
        <select
          id="entityId"
          name="entityId"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="w-full rounded border border-gray-300 p-2"
        >
          <option value="">Choisir une filiale…</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-gray-900">Facture PDF</span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-4 text-center text-sm ${
            isDragging ? "border-blue-600 bg-blue-50" : "border-gray-300 text-gray-500"
          }`}
        >
          {fileName ? (
            <span className="font-medium text-gray-900">{fileName}</span>
          ) : (
            <span>Déposez un PDF ici, ou cliquez pour en choisir un</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          name="pdf"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>

      {localError && <p className="text-sm text-red-700">{localError}</p>}

      <SubmitButton disabled={!entityId || !fileName} />
    </form>
  );
}
