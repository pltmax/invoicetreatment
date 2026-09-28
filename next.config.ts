import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // @react-pdf/renderer (and its ESM-only deps like @react-pdf/hyphenate)
  // is imported dynamically in lib/pdf/document.tsx to route around a CJS
  // resolution failure under tsx. Left to Next's own bundler it 500s only
  // in the deployed Vercel function (works fine in `next dev`/`next start`
  // locally, where the full node_modules tree papers over any bundling
  // gap) — keeping it external makes Next's file tracing ship its real
  // files as-is instead of trying to bundle/tree-shake them.
  serverExternalPackages: ["@react-pdf/renderer"],
  // pdfkit (a dependency of @react-pdf/renderer) loads its standard-font
  // data files (Helvetica.cjs etc., plus their chunks/ subfolder) through a
  // runtime-computed require Next's file tracer can't statically follow, so
  // they were silently dropped from the deployed function — confirmed via
  // Vercel runtime logs: "Cannot find module
  // '/var/task/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs'".
  // Forcing them in here is the standard fix for this class of pdfkit/nft
  // gap on Vercel.
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
