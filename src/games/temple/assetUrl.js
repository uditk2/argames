// Resolve a runtime asset URL against the deployment base so it works both on
// the portal ('/') and the CrazyGames standalone build ('./'). Vite statically
// replaces import.meta.env.BASE_URL at build time.
export function assetUrl(p) {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/?$/, '/') + String(p).replace(/^\/+/, '');
}
export default assetUrl;
