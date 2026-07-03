// bootstrap.ts — loads the ported mobile design modules in the exact order the
// original main.tsx used, so each module's window globals (React, FX, FXAuth,
// FXAPI, FXLive, FXWallet, theme/UI primitives, and every screen component) are
// registered before any route renders. Client-only — never imported on the server.
//
// NOTE: we deliberately do NOT import shell.jsx — its <App> owns the old
// single-SPA navigation/chrome, which Next.js routing + the layout replace.
// Shared design modules live in ../../shared (imported via the @shared alias);
// app-specific screens (shell, wallet) stay local to this app.
import './react-global.js';
import '@shared/settings.js';
import '@shared/data/fx-mock.js';
import '@shared/lib/fx-auth.js';
import '@shared/lib/fx-api.js';
import '@shared/lib/fx-live.js';
import '@shared/lib/fx-wallet.js';
import '@shared/lib/fx-watch.js';
import '@shared/lib/fx-push.js';

import '@shared/screens/theme.jsx';
import '@shared/screens/ui.jsx';
import '@shared/screens/pointer.jsx';
import '@shared/screens/markets.jsx';
import '@shared/screens/trade.jsx';
import '@shared/screens/signals.jsx';
import '@shared/screens/portfolio.jsx';
import '@shared/screens/copytrade.jsx';
import './screens/wallet.jsx';
import '@shared/screens/profile-screens.jsx';
import '@shared/screens/automation.jsx';
import '@shared/screens/paywall.jsx';
import '@shared/screens/onboarding.jsx';
// Imported last only to register its `Profile` + `BottomNav` on window; its <App>
// (old SPA shell) is never rendered — Next.js routing replaces it.
import './screens/shell.jsx';

export const BOOTSTRAPPED = true;
