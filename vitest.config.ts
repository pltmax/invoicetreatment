import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    server: {
      deps: {
        // Force @react-pdf/* through Vite's own module graph (instead of
        // being externalized and resolved by Node directly) so the "react"
        // alias below actually applies to their internal `import ... from
        // "react"` statements too.
        inline: [/@react-pdf\//],
      },
    },
  },
  resolve: {
    // "react-server" is needed so `import "server-only"` resolves to its
    // no-op export instead of throwing (see lib/db, lib/sessions.ts, etc.).
    // React's own package.json also defines a "react-server" export
    // condition, pointing at a stripped-down RSC build that lacks client
    // internals (e.g. useState, __CLIENT_INTERNALS_DO_NOT_USE...). That
    // breaks @react-pdf/renderer, which uses a real react-reconciler and
    // needs the full client build. Alias "react" past the conditions-based
    // export lookup so it always resolves to the full build, while leaving
    // the "react-server" condition in place for every other package.
    //
    // Note: scripts/server-only-noop.ts + tsconfig.seed.json solve this same
    // underlying conflict the opposite way (drop the condition, alias
    // "server-only" instead) because Node scripts can't alias "react" here.
    conditions: ["react-server"],
    // Array/regex form so the match is exact: with the plain object form,
    // @rollup/plugin-alias also rewrites "react/jsx-runtime" (prefix match)
    // to a nonexistent ".../react/index.js/jsx-runtime".
    alias: [
      {
        find: /^react$/,
        replacement: fileURLToPath(new URL("./node_modules/react/index.js", import.meta.url)),
      },
    ],
  },
});
