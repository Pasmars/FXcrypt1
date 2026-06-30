// Module-level payload store: the old SPA passed objects via go(key, props).
// With real routes we stash the payload here and read it synchronously in the
// target route after router.push (objects like a token/signal aren't URL-safe).
const payloads: Record<string, any> = {};
export const setPayload = (key: string, p: any) => { payloads[key] = p || {}; };
export const getPayload = (key: string) => payloads[key] || {};

// Map an old navigation key to a real URL path.
export const keyToPath = (key: string): string => {
  if (key === 'pointer') return '/';
  return '/' + key;
};

// Reverse: pathname → active tab id (for the bottom nav).
export const pathToTab = (path: string): string => {
  if (path === '/' || path.startsWith('/pointer')) return 'pointer';
  if (path.startsWith('/markets')) return 'markets';
  if (path.startsWith('/signals')) return 'signals';
  if (path.startsWith('/wallet')) return 'wallet';
  return '';
};
