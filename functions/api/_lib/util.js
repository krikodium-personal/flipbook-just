// Utilidades compartidas por las Pages Functions de la API.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export const error = (message, status = 400) => json({ error: message }, status);

export const pdfKey = (id) => `pdfs/${id}.pdf`;

export const newId = () => `c${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;

// Resumen para el listado (sin hotspots)
export function toMeta(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? null,
    pages: row.pages ?? null,
    products: row.products ?? 0,
    links: row.links ?? 0,
    cover: row.cover ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCatalog(row) {
  return { ...toMeta(row), hotspots: JSON.parse(row.hotspots || '[]'), outline: parseOutline(row.outline) };
}

export const parseOutline = (v) => (v ? JSON.parse(v) : null);

// Índice de contenidos: [{ title, page, children }]. Se limpia y se acota (profundidad y cantidad).
export function sanitizeOutline(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) throw new Error('outline debe ser una lista');
  let count = 0;
  const walk = (items, depth) =>
    items.slice(0, 200).flatMap((it) => {
      if (++count > 1000 || depth > 5 || !it || typeof it !== 'object') return [];
      const title = String(it.title ?? '').slice(0, 200).trim();
      const page = Number.isInteger(it.page) && it.page > 0 ? it.page : null;
      const children = Array.isArray(it.children) ? walk(it.children, depth + 1) : [];
      return title && (page || children.length) ? [{ title, page, children }] : [];
    });
  return walk(input, 1);
}

// Valida y limpia la lista de hotspots que manda el editor. Se guardan solo los campos conocidos.
export function sanitizeHotspots(input) {
  if (!Array.isArray(input)) throw new Error('hotspots debe ser una lista');
  if (input.length > 5000) throw new Error('Demasiados elementos');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
  const str = (v, max = 300) => String(v ?? '').slice(0, max);
  return input.map((h, i) => {
    const base = { id: str(h.id || `h${i}`, 40), page: Math.max(1, parseInt(h.page, 10) || 1), x: num(h.x), y: num(h.y) };
    if (h.type === 'link') {
      const kind = h.kind === 'url' ? 'url' : 'page';
      const url = kind === 'url' ? safeUrl(h.url) : '';
      return {
        ...base,
        type: 'link',
        w: num(h.w),
        h: num(h.h),
        kind,
        target: Number.isInteger(h.target) ? h.target : null,
        url,
      };
    }
    const out = { ...base, code: str(h.code, 80), sale: Boolean(h.sale) };
    if (h.source === 'pdf-layer') out.source = 'pdf-layer';
    return out;
  });
}

// Solo http/https (misma regla que el editor): nunca javascript:, data:, etc.
function safeUrl(v) {
  try {
    const u = new URL(String(v ?? ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href.slice(0, 2000) : '';
  } catch {
    return '';
  }
}

export function counts(hotspots) {
  const links = hotspots.filter((h) => h.type === 'link').length;
  return { products: hotspots.length - links, links };
}

export const MAX_PDF_BYTES = 95 * 1024 * 1024; // límite de cuerpo de Pages Functions (plan Free: 100 MB)
