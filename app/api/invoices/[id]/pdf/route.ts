import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { getInvoicePdfPathname, getInvoicePdfSourceById } from "@/lib/db/queries";
import { renderInvoicePdf } from "@/lib/pdf/generate";
import { storeInvoicePdf } from "@/lib/pdf/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  // No user auth exists yet in this demo — once it does, this is where a
  // check belongs (verify the caller may view this invoice) before the
  // PDF is streamed back.
  const pathname = await getInvoicePdfPathname(db, id);

  if (!pathname) {
    // Happens for every invoice after "Réinitialiser la démo": that button
    // reseeds the DB but doesn't re-run the (~20s, too slow for a request)
    // bulk PDF generation script. Rather than 404 forever, render this one
    // invoice's PDF on demand from its own row — the same deterministic
    // render the bulk seed step would have produced — and store it so the
    // next request hits the blob directly.
    const source = await getInvoicePdfSourceById(db, id);
    if (!source) {
      return new NextResponse(null, { status: 404 });
    }
    const pdf = await renderInvoicePdf(source);
    await storeInvoicePdf(db, id, pdf);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-cache",
      },
    });
  }

  // get() throws (rather than returning null) on credential/config failures,
  // e.g. a missing BLOB_READ_WRITE_TOKEN. Without this the caller would get
  // Next.js's HTML 500 page inside an iframe that expects a PDF.
  let result;
  try {
    result = await get(pathname, { access: "private" });
  } catch (err) {
    console.error(`Failed to fetch PDF blob for invoice ${id}:`, err);
    return new NextResponse(null, { status: 502 });
  }

  if (!result || result.statusCode !== 200) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-cache",
    },
  });
}
