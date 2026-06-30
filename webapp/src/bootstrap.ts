// bootstrap.ts — loads the ported mobile design modules in the exact order the
// original main.tsx used, so each module's window globals (React, FX, FXAuth,
// FXAPI, FXLive, FXWallet, theme/UI primitives, and every screen component) are
// registered before any route renders. Client-only — never imported on the server.
//
// NOTE: we deliberately do NOT import shell.jsx — its <App> owns the old
// single-SPA navigation/chrome, which Next.js routing + the layout replace.
import './react-global.js';
import './settings.js';
import './data/fx-mock.js';
import './lib/fx-auth.js';
import './lib/fx-api.js';
import './lib/fx-live.js';
import './lib/fx-wallet.js';
import './lib/fx-watch.js';

import './screens/theme.jsx';
import './screens/ui.jsx';
import './screens/pointer.jsx';
import './screens/markets.jsx';
import './screens/trade.jsx';
import './screens/signals.jsx';
import './screens/wallet.jsx';
import './screens/profile-screens.jsx';
import './screens/automation.jsx';
import './screens/paywall.jsx';
import './screens/onboarding.jsx';
// Imported last only to register its `Profile` + `BottomNav` on window; its <App>
// (old SPA shell) is never rendered — Next.js routing replaces it.
import './screens/shell.jsx';

export const BOOTSTRAPPED = true;
