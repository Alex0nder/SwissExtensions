# Frontend monorepo (shadcn + Vite)

## Apps
- `apps/web` — marketing landing (Netlify)
- `apps/swiss-ui` — Chrome extension UI pages (side panel, history, result, suspended)
- `packages/ui` — shared shadcn components + Swiss theme tokens

## Commands
```bash
cd frontend
npm install
npm run dev:web          # landing
npm run build:web        # landing → apps/web/dist (+ favicon/downloads)
npm run build:swiss-ui   # → SwissExtensions/ui-dist
```

Netlify: root `netlify.toml` runs `npm run build:web` and publishes `frontend/apps/web/dist`.
