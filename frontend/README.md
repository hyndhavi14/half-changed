# React + TypeScript + Vite

## Phase 6 live UAT

Run the authenticated demo workflow at `http://localhost:5173/phase6`. Configure
the ignored local `frontend/.env.local` with `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and optionally `VITE_API_URL` /
`VITE_FACTORY_3D_URL`. The Supabase key in a browser environment must be the
publishable/legacy anon key only; never put a secret or service-role key in
frontend configuration. Sign in through the page with the dedicated demo
account at runtime; do not store its password in a file.

The page checks the user's factory grant and protected API behavior, captures
one read-only pre-run snapshot, then enables exactly one non-dry-run
optimization request. It never retries that write and displays Backend
read-back evidence. Factory-3D remains a separate app and requires a separate
normal sign-in after opening the canonical schedule link.

## SolarShift historical replay

Start the Backend first so Vite's `/api` proxy has a JSON API to reach:

```bash
cd backend
npm run dev
```

In a second terminal:

```bash
cd frontend
npm run dev
```

The Backend listens on `http://localhost:3000`; Vite listens on
`http://localhost:5173` and proxies `/api/*` to the Backend. Do not run the
Backend on Vite's port: proxy error pages are not Backend JSON responses.
Then open `http://localhost:5173/solarshift-historical`.
This allowlisted HGD/LGD replay is public and read-only; it loads the persisted
scenario data from the Backend public endpoint without requiring sign-in.
Protected workspace pages still require Supabase Auth. The 3D replay opens the
separate Factory-3D app at `http://localhost:5174/?scenario=hgd` or
`?scenario=lgd`; use `&schedule=baseline` to select the stored baseline, with
the optimized schedule selected by default.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
