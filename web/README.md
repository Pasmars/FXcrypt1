# FXcrypt — React + Next.js frontend

Modern rewrite of the FXcrypt app (App Router, TypeScript, Tailwind). The **backend is
unchanged** — this app calls the same Firebase Auth, Firestore and callable Cloud
Functions (`europe-west1`) as the legacy static site.

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

## Build

```bash
npm run build      # production build (SSR, for Firebase App Hosting)
npm start          # serve the production build
```

## Deploy — Firebase App Hosting (SSR)

App Hosting builds from a connected GitHub repo. One-time setup:

```bash
# from the repo root
firebase apphosting:backends:create --project pnl-calculator
#  • when prompted, set the app root directory to:  web
#  • connect the GitHub repo + branch you push this code to
```

After the backend exists, every push to the connected branch triggers a build & rollout.
`web/apphosting.yaml` controls runtime (instances, CPU, memory).

> Note: the legacy static app keeps running on Firebase Hosting at
> https://pnl-calculator.web.app until this migration is finished and you cut over.

## Migration status

| Screen | Status |
|--------|--------|
| Login / Signup | ✅ migrated |
| PnL Calculator (crypto + forex + converter) | ✅ migrated |
| Profile | ✅ migrated |
| Prices · Tracker/Bubble Map · DEX Bot · AI Agent · Wallet | ⏳ stubbed (next phases) |

## Architecture

- `app/` — App Router pages (each page is a client component using the shared `AppShell`)
- `components/` — `AppShell` (sidebar + mobile bottom-nav + drawer), `ui/` design-system primitives, icons, Logo
- `lib/` — `firebase.ts` (client init), `auth.tsx` (AuthProvider + `useAuth`), `functions.ts` (callable wrappers), `format.ts`, `currencies.ts`, `nav.ts`
- Styling: Tailwind with semantic tokens in `tailwind.config.ts`; component classes in `app/globals.css`
