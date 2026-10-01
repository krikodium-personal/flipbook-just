export const config = {
  // directus → Directus real (default) · mock → productos inventados, sin conexión
  productsSource: import.meta.env.VITE_PRODUCTS_SOURCE ?? 'directus',
  // mock → carrito simulado en el navegador · shopify → Ajax Cart API (solo servido desde el dominio de la tienda)
  cart: import.meta.env.VITE_CART ?? 'mock',
  directus: {
    url: import.meta.env.VITE_DIRECTUS_URL ?? 'https://directus-production-4078.up.railway.app',
    // Hoy no hace falta: el rol Public ya lee products/product_variants/variants/prices.
    // Si se usa, que sea de SOLO LECTURA: en el tema de Shopify queda visible para cualquiera.
    token: import.meta.env.VITE_DIRECTUS_TOKEN ?? '',
    // Mercado cuyos precios se muestran. SUPUESTO: 1 = Argentina (precios en ARS). La colección
    // "markets" no es pública, así que no se pudo confirmar.
    market: import.meta.env.VITE_DIRECTUS_MARKET ?? '1',
  },
  locale: 'es-AR',
  currency: 'ARS',
};
