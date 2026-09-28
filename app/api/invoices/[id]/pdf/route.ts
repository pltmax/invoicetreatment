import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { getInvoicePdfPathname } from "@/lib/db/queries";

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
    return new NextResponse(null, { status: 404 });
  }

  const result = await get(pathname, { access: "private" });
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
