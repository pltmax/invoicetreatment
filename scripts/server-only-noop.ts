// Stand-in for the `server-only` package when scripts run outside Next.js.
// Mirrors node_modules/server-only/empty.js (which is empty): intentionally no
// exports and no logic. Node scripts cannot use `--conditions=react-server`
// (it makes React resolve to its react-server build, which @react-pdf's
// reconciler cannot use), so tsconfig.seed.json maps `server-only` here
// instead. The app itself keeps the real guard.
//
// Note: vitest.config.ts solves this same underlying conflict the opposite way
// (keep the react-server condition, alias "react" past it) — see its comment.
