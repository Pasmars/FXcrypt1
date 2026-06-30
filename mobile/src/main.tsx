// main.tsx — FXcrypt mobile SPA entry.
// Import order matters: react-global sets window.React before any design module
// evaluates; settings provides window.useTweaks; the data module sets window.FX;
// theme/ui register shared primitives on window; screens register their
// components; shell registers window.App. Then we render.
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
import './screens/shell.jsx';

import React from 'react';
import { createRoot } from 'react-dom/client';

const App = (window as any).App as React.ComponentType;
createRoot(document.getElementById('root')!).render(React.createElement(App));
