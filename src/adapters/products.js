// Fuente de información detallada de producto (Directus).
// Interfaz común: { getByCode(code), list() } → producto normalizado:
//   { key, name, tagline, description, benefits[], images[], ecommerceUrl,
//     variants[{ code, label, price (centavos | null), shopifyVariantId }], selectedCode }
//
// Modelo real de Directus (directus-production-4078):
//   products          name, description_short, description_long, photo, gallery_items (O2M), benefits (JSON),
//                     product_code, slug, ecommerce_url, variants (O2M → product_variants)
//   product_variants  code (código del catálogo), product_id, variant_id (M2O → variants), prices (O2M)
//   variants          capacity_value, capacity_unit, name
//   prices            price, market   ← un precio por mercado (market 1 = Argentina, supuesto)
//
// El "+" del catálogo guarda una clave que se busca en este orden:
//   1. product_variants.code   2. products.product_code   3. products.slug   4. "#<id>" (último recurso)
import { config } from '../config.js';
import { directusProducts } from '../data/mock-data.js';

export function createProductSource() {
  return config.productsSource === 'mock' ? mockSource() : directusSource(config.directus);
}

const PRODUCT_FIELDS = [
  'id',
  'name',
  'slug',
  'product_code',
  'description_short',
  'description_long',
  'photo',
  'ecommerce_url',
  'benefits',
  'uses_suggestions',
  'show_benefits',
  'show_usage_modes',
  'show_uses_suggestions',
  'show_custom_usage_modes',
  'usage_modes.is_recommended',
  'usage_modes.custom_text',
  'usage_modes.usage_mode_id.title',
  'usage_modes.usage_mode_id.photo',
  'usage_modes.usage_mode_id.description',
  'custom_usage_modes.title',
  'custom_usage_modes.description',
  'gallery_items.type',
  'gallery_items.status',
  'gallery_items.sort',
  'gallery_items.directus_file',
  'variants.code',
  'variants.variant_id.capacity_value',
  'variants.variant_id.capacity_unit',
  'variants.variant_id.name',
  'variants.prices.price',
  'variants.prices.market',
  // Productos relacionados (M2M products ↔ products en Directus: related_products.related_products_id)
  ...['id', 'name', 'photo', 'description_short', 'product_code', 'slug', 'variants.code', 'variants.prices.price', 'variants.prices.market',
    'variants.variant_id.capacity_value', 'variants.variant_id.capacity_unit', 'variants.variant_id.name'].map(
    (f) => `related_products.related_products_id.${f}`,
  ),
].join(',');

function directusSource({ url, token, market }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const get = async (path, params) => {
    const res = await fetch(`${url}${path}?${new URLSearchParams(params)}`, { headers });
    if (!res.ok) throw new Error(`Directus respondió ${res.status}`);
    return (await res.json()).data;
  };
  const findProduct = async (filter) => (await get('/items/products', { ...filter, fields: PRODUCT_FIELDS, limit: '1' }))[0];

  const normalize = (p, key) => {
    const images = (p.gallery_items ?? [])
      .filter((g) => g.type === 'image' && g.directus_file && g.status !== 'draft' && g.status !== 'archived')
      .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999))
      .map((g) => g.directus_file);
    if (!images.length && p.photo) images.push(p.photo);

    const variants = (p.variants ?? []).map((v) => {
      const price = v.prices?.find((x) => String(x.market) === String(market))?.price;
      return {
        code: v.code,
        label: variantLabel(v.variant_id),
        price: price != null ? Math.round(Number(price) * 100) : null,
        shopifyVariantId: v.shopify_variant_id ?? null, // todavía no existe en Directus
      };
    });

    return {
      key,
      name: p.name,
      tagline: p.description_short,
      description: p.description_long,
      // Secciones en pestañas; cada una respeta su "show_*" de Directus (si falta el campo, se muestra)
      benefits: p.show_benefits === false ? [] : (p.benefits ?? []).filter((b) => b.benefit || b.description),
      usageModes: [
        ...(p.show_usage_modes === false ? [] : p.usage_modes ?? [])
          .filter((u) => u.usage_mode_id)
          .sort((a, b) => Number(b.is_recommended) - Number(a.is_recommended))
          .map((u) => ({
            title: u.usage_mode_id.title,
            text: u.custom_text?.trim() || u.usage_mode_id.description,
            image: u.usage_mode_id.photo ? `${url}/assets/${u.usage_mode_id.photo}?width=160&height=160&fit=cover&format=webp` : null,
          })),
        ...(p.show_custom_usage_modes ? p.custom_usage_modes ?? [] : []).map((u) => ({ title: u.title, text: u.description, image: null })),
      ].filter((u) => u.title || u.text),
      suggestions: p.show_uses_suggestions === false ? [] : (p.uses_suggestions ?? []).map((x) => x.description).filter(Boolean),
      images: [...new Set(images)].map((id) => `${url}/assets/${id}?width=800&format=webp`),
      ecommerceUrl: p.ecommerce_url,
      variants,
      selectedCode: variants.some((v) => v.code === key) ? key : variants[0]?.code,
      related: (p.related_products ?? [])
        .map((r) => r.related_products_id)
        .filter((r) => r && r.id !== p.id)
        .map((r) => {
          // Precio "desde": el menor entre las presentaciones con precio en el mercado configurado;
          // la presentación que se muestra es la de ese precio
          const priced = (r.variants ?? [])
            .map((v) => ({ v, price: v.prices?.find((x) => String(x.market) === String(market))?.price }))
            .filter((x) => x.price != null)
            .map((x) => ({ ...x, price: Math.round(Number(x.price) * 100) }))
            .sort((a, b) => a.price - b.price);
          const cheapest = priced[0];
          return {
            key: (cheapest?.v ?? r.variants?.[0])?.code || r.product_code || r.slug || `#${r.id}`,
            name: r.name,
            tagline: r.description_short,
            image: r.photo ? `${url}/assets/${r.photo}?width=400&format=webp` : null,
            price: cheapest?.price ?? null,
            multiplePrices: priced.length > 1,
            size: cheapest ? variantLabel(cheapest.v.variant_id) : r.variants?.length === 1 ? variantLabel(r.variants[0].variant_id) : null,
          };
        }),
    };
  };

  return {
    async getByCode(key) {
      if (/^#\d+$/.test(key)) {
        const product = await findProduct({ 'filter[id][_eq]': key.slice(1) });
        return product ? normalize(product, key) : null;
      }
      const [variant] = await get('/items/product_variants', { 'filter[code][_eq]': key, fields: 'product_id', limit: '1' });
      const product =
        (variant && (await findProduct({ 'filter[id][_eq]': variant.product_id }))) ||
        (await findProduct({ 'filter[product_code][_eq]': key })) ||
        (await findProduct({ 'filter[slug][_eq]': key }));
      return product ? normalize(product, key) : null;
    },
    // Opciones para el editor: una por variante con código; los productos sin variantes, por product_code o slug.
    async list() {
      const products = await get('/items/products', {
        fields: 'id,name,slug,product_code,variants.code,variants.variant_id.capacity_value,variants.variant_id.capacity_unit,variants.variant_id.name',
        limit: '-1',
        sort: 'name',
      });
      return products.flatMap((p) =>
        p.variants?.length
          ? p.variants.map((v) => ({ code: v.code, name: `${p.name} · ${variantLabel(v.variant_id)}` }))
          : [{ code: p.product_code || p.slug || `#${p.id}`, name: `${p.name}${p.product_code ? '' : ' (sin código en Directus)'}` }],
      );
    },
  };
}

function variantLabel(v) {
  if (!v) return 'Única';
  return v.name || [v.capacity_value, v.capacity_unit].filter(Boolean).join(' ') || 'Única';
}

// ---------- Mock (sin conexión) ----------
function mockSource() {
  const normalize = (p, key) => ({
    key,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    benefits: [],
    usageModes: [],
    suggestions: [],
    images: [placeholderImage(p.name, p.color)],
    ecommerceUrl: null,
    variants: p.variants.map((v, i) => ({
      code: i === 0 ? p.code : `${p.code}-${i}`,
      label: v.label,
      price: 1000000 * (i + 2),
      shopifyVariantId: v.shopify_variant_id,
    })),
    selectedCode: p.code,
    related: [],
  });
  return {
    async getByCode(code) {
      const p = directusProducts.find((x) => x.code === code);
      return p ? normalize(p, code) : null;
    },
    async list() {
      return directusProducts.map((p) => ({ code: p.code, name: p.name }));
    },
  };
}

function placeholderImage(name, color) {
  const initials = name.split(' ').filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f6f3ec"/><rect x="120" y="95" width="160" height="250" rx="24" fill="${color}"/><text x="200" y="235" font-family="Helvetica" font-size="44" font-weight="bold" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
