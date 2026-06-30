// settings.js — replacement for the prototype's tweaks-panel `useTweaks`.
// Same API shape shell.jsx expects: `const [t, setTweak] = useTweaks(defaults)`,
// where `t` is the settings object and `setTweak(key, value)` updates one key.
// Backed by localStorage so theme/accent/plan persist across sessions.
const KEY = 'fx_settings';

function load(defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaults, ...saved };
  } catch (e) {
    return { ...defaults };
  }
}

function useTweaks(defaults) {
  const { useState, useCallback } = window.React;
  const [t, setT] = useState(() => load(defaults));
  const setTweak = useCallback((key, value) => {
    setT((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, []);
  return [t, setTweak];
}

window.useTweaks = useTweaks;

export { useTweaks };
