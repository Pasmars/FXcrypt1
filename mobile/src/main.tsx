// main.tsx — FXcrypt mobile SPA entry.
// Import order matters: react-global sets window.React before any design module
// evaluates; settings provides window.useTweaks; the data module sets window.FX;
// theme/ui register shared primitives on window; screens register their
// components; shell registers window.App. Then we render.
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
import './screens/shell.jsx';

import React from 'react';
import { createRoot } from 'react-dom/client';

const App = (window as any).App as React.ComponentType;
createRoot(document.getElementById('root')!).render(React.createElement(App));
