// GET /api/public/arbell/:code → ficha de un producto de Arbell a partir de su CÓDIGO ("Codigo: 6135" en la ficha).
// También acepta "#<id>" (el id de la URL /productos/vista/<id>), que es lo único que traen los productos relacionados.
// arbell.com.ar no tiene API: se busca el código en su buscador, se leen las páginas de producto y se devuelve la
// que tiene exactamente ese código. El id de la URL (/productos/vista/8271) no es el código del catálogo.
import { json, error } from '../../_lib/util.js';

const BASE = 'https://www.arbell.com.ar';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; flipbook-catalogo)' };
const MAX_CANDIDATES = 6;

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const text = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// "$13,500.00" → 13500
const money = (s) => {
  const n = Number(String(s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function fetchHtml(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Arbell respondió ${res.status}`);
  return res.text();
}

// Carrusel "Productos Relacionados" de la ficha: id (de la URL), nombre, foto y precios. No trae el código.
function parseRelated(html) {
  const section = html.split('Productos Relacionados')[1] ?? '';
  return section
    .split('<div class="product-wrap">')
    .slice(1)
    .map((block) => {
      const id = /\/productos\/vista\/(\d+)/.exec(block)?.[1];
      const [price, oldPrice] = [...(/<div class="product-price">(.*?)<\/div>/s.exec(block)?.[1] ?? '').matchAll(/<span[^>]*>(.*?)<\/span>/gs)].map((m) => money(text(m[1])));
      return {
        id,
        name: text(/<h3>(.*?)<\/h3>/s.exec(block)?.[1] ?? ''),
        image: /<img src="(https:\/\/app\.arbell\.com\.ar[^"]+)"/.exec(block)?.[1] ?? null,
        price: price ?? null,
        oldPrice: oldPrice ?? null,
      };
    })
    .filter((r) => r.id && r.name)
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i) // el carrusel de Arbell repite productos
    .slice(0, 12);
}

function parseProduct(html, id) {
  const pick = (re) => re.exec(html)?.[1] ?? '';
  const main = html.split('Productos Relacionados')[0];
  const prices = /<div class="product-details-price">(.*?)<\/div>/s.exec(main);
  const [price, oldPrice] = prices ? [...prices[1].matchAll(/<span[^>]*>(.*?)<\/span>/gs)].map((m) => money(text(m[1]))) : [];
  const images = [...new Set([...main.matchAll(/src="(https:\/\/app\.arbell\.com\.ar\/img\/producto\/(?:chica|extras)\/[^"]+)"/g)].map((m) => encodeURI(decode(m[1]))))];
  return {
    id,
    code: text(pick(/Codigo:\s*([^<]*)/)),
    name: text(pick(/<h2 style="margin-bottom: 20px">(.*?)<\/h2>/s)),
    price,
    oldPrice: oldPrice ?? null,
    description: text(pick(/<div class="product-details-price">\s*<\/div>\s*(.*?)<div class="pro-details-size-color">/s)),
    netContent: text(pick(/Contenido Neto.*?<p>(.*?)<\/p>/s)),
    images,
    related: parseRelated(html),
    url: `${BASE}/productos/vista/${id}`,
  };
}

export async function onRequestGet({ params, request, waitUntil }) {
  let code = String(params.code ?? '').trim();
  try {
    code = decodeURIComponent(code); // "%235161" → "#5161"
  } catch {
    return error('Código inválido');
  }
  if (!/^([A-Za-z0-9-]{1,20}|#\d{1,9})$/.test(code)) return error('Código inválido');

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/api/public/arbell/${encodeURIComponent(code.toUpperCase())}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    let found;
    if (code.startsWith('#')) {
      found = parseProduct(await fetchHtml(`/productos/vista/${code.slice(1)}`), code.slice(1));
      if (!found.name) found = null;
    } else {
      const search = await fetchHtml(`/productos/buscar?search=${encodeURIComponent(code)}`);
      const ids = [...new Set([...search.matchAll(/\/productos\/vista\/(\d+)/g)].map((m) => m[1]))].slice(0, MAX_CANDIDATES);
      const products = await Promise.all(ids.map(async (id) => parseProduct(await fetchHtml(`/productos/vista/${id}`), id)));
      found = products.find((p) => p.code.toLowerCase() === code.toLowerCase());
    }
    if (!found) return error('Código no encontrado en Arbell', 404);

    const res = json(found, 200, { 'Cache-Control': 'public, max-age=300, s-maxage=3600' });
    waitUntil?.(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return error(err.message, 502);
  }
}
