// Áreas de enlace: llevan a una página del catálogo (kind 'page', campo target) o a una web externa (kind 'url').
// Enlaces viejos sin `kind` son de página.

export const linkKind = (h) => (h.kind === 'url' ? 'url' : 'page');

// Normaliza lo que escribe el usuario ("justargentina.com/tienda" → "https://justargentina.com/tienda").
// Solo acepta http/https: evita javascript:, data:, etc. Devuelve null si no es una dirección válida.
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function urlHost(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
