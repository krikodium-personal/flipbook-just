// Carrito.
// shopify → Ajax Cart API del tema (/cart.js, /cart/add.js, /cart/change.js): comparte el carrito nativo de la
//           tienda. Solo funciona servido desde el dominio de la tienda y requiere que cada variante tenga
//           shopifyVariantId (hoy ese campo no existe en Directus).
// mock    → carrito en localStorage con la misma forma que /cart.js, usando el precio de Directus.
import { config } from '../config.js';

// scope: id del catálogo. El carrito simulado es exclusivo de cada catálogo (el de Shopify es el de la tienda).
export function createCart(scope = '') {
  return config.cart === 'shopify' ? shopifyCart() : mockCart(scope);
}

function shopifyCart() {
  const root = window.Shopify?.routes?.root ?? '/';
  const json = async (path, body) => {
    const res = await fetch(`${root}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).description ?? `Shopify ${res.status}`);
    return res.json();
  };
  return {
    canBuy: (variant) => Boolean(variant.shopifyVariantId),
    get: () => json('cart.js'),
    async add(product, variant, quantity) {
      if (!variant.shopifyVariantId) throw new Error('Variante sin equivalencia en Shopify');
      await json('cart/add.js', { items: [{ id: variant.shopifyVariantId, quantity, properties: { _catalogo: variant.code } }] });
      const cart = await json('cart.js');
      // Muchos temas escuchan un evento así para refrescar el contador del header
      document.dispatchEvent(new CustomEvent('cart:refresh', { detail: cart }));
      return cart;
    },
    change: (key, quantity) => json('cart/change.js', { id: key, quantity }),
    checkout() {
      window.location.href = `${root}checkout`;
    },
  };
}

function mockCart(scope) {
  const KEY = `flipbook-mock-cart-v3:${scope}`;
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? [];
    } catch {
      return [];
    }
  };
  const save = (lines) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {}
  };
  const toCart = (lines) => ({
    items: lines.map((l) => ({ ...l, line_price: l.price * l.quantity })),
    item_count: lines.reduce((s, l) => s + l.quantity, 0),
    total_price: lines.reduce((s, l) => s + l.price * l.quantity, 0),
  });
  return {
    canBuy: (variant) => variant.price != null,
    get: async () => toCart(load()),
    async add(product, variant, quantity) {
      if (variant.price == null) throw new Error('Variante sin precio');
      const lines = load();
      const line = lines.find((l) => l.key === variant.code);
      if (line) line.quantity += quantity;
      else lines.push({ key: variant.code, image: product.image, product_title: product.name, variant_title: variant.label, sku: variant.code, price: variant.price, quantity });
      save(lines);
      return toCart(lines);
    },
    async change(key, quantity) {
      const lines = load()
        .map((l) => (l.key === key ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0);
      save(lines);
      return toCart(lines);
    },
    checkout() {
      alert('Modo prototipo: acá se redirigiría al checkout de Shopify con este carrito.');
    },
  };
}

export function formatMoney(cents, { decimals = false } = {}) {
  const digits = decimals ? {} : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  return new Intl.NumberFormat(config.locale, { style: 'currency', currency: config.currency, ...digits }).format(cents / 100);
}
