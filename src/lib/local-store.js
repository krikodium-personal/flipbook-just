// LEGADO: catálogos guardados en IndexedDB por las primeras versiones del prototipo (solo en este navegador).
// Hoy se usa únicamente para ofrecer subirlos a Cloudflare desde el listado (ver src/home.js).
// En producción: PDF/imágenes en un CDN y catálogos + hotspots en Directus (colección "catalogs").
//
// Dos stores:
//   catalogs  id → catálogo completo { id, name, title, pdf: ArrayBuffer, hotspots, createdAt, updatedAt }
//   meta      id → resumen liviano para el listado { id, name, title, pages, products, links, cover, createdAt, updatedAt }
//             (así la página de inicio no carga PDFs de 20 MB para mostrar la lista)
//
// name  = nombre del archivo PDF original · title = título elegido en el editor (null → se muestra name)
// hotspots: ver src/editor.js (productos { page, x, y, code, sale } y enlaces { type: 'link', page, x, y, w, h, target })
const DB = 'flipbook-catalogo';
const VERSION = 2;
const CATALOGS = 'catalogs';
const META = 'meta';
const LEGACY_ID = 'current'; // v1 guardaba un único catálogo con esta clave

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const t = req.transaction;
      if (!db.objectStoreNames.contains(CATALOGS)) db.createObjectStore(CATALOGS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      // Migración v1 → v2: el catálogo único pasa a tener id propio y aparece en el listado
      if (e.oldVersion === 1) {
        const store = t.objectStore(CATALOGS);
        const get = store.get(LEGACY_ID);
        get.onsuccess = () => {
          const old = get.result;
          if (!old) return;
          const now = Date.now();
          const catalog = { ...old, id: newId(), title: old.title ?? null, createdAt: now, updatedAt: now };
          store.put(catalog, catalog.id);
          store.delete(LEGACY_ID);
          t.objectStore(META).put(toMeta(catalog), catalog.id);
        };
      }
    };
    req.onsuccess = () => {
      // Si otra pestaña necesita actualizar la base, soltarla para no bloquearla
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function toMeta(c, extra = {}) {
  const links = c.hotspots.filter((h) => h.type === 'link').length;
  return {
    id: c.id,
    name: c.name,
    title: c.title ?? null,
    pages: c.pages ?? null,
    products: c.hotspots.length - links,
    links,
    cover: c.cover ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...extra,
  };
}

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const catalogTitle = (c) => c?.title?.trim() || c?.name || 'Catálogo';

export async function listCatalogs() {
  const all = (await tx(META, 'readonly', (t) => t.objectStore(META).getAll())) ?? [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCatalog(id) {
  if (!id) return null;
  try {
    return (await tx(CATALOGS, 'readonly', (t) => t.objectStore(CATALOGS).get(id))) ?? null;
  } catch {
    return null;
  }
}

// { name, pdf, hotspots?, title?, pages?, cover? } → catálogo guardado con id
export async function createCatalog(data) {
  const now = Date.now();
  const catalog = { hotspots: [], title: null, ...data, id: newId(), createdAt: now, updatedAt: now };
  await saveCatalog(catalog, { touch: false });
  return catalog;
}

export function saveCatalog(catalog, { touch = true } = {}) {
  if (touch) catalog.updatedAt = Date.now();
  return tx([CATALOGS, META], 'readwrite', (t) => {
    t.objectStore(META).put(toMeta(catalog), catalog.id);
    return t.objectStore(CATALOGS).put(catalog, catalog.id);
  });
}

// Solo actualiza el resumen (p. ej. para guardar la portada generada en el listado)
export async function patchMeta(id, patch) {
  const meta = await tx(META, 'readonly', (t) => t.objectStore(META).get(id));
  if (!meta) return;
  await tx(META, 'readwrite', (t) => t.objectStore(META).put({ ...meta, ...patch }, id));
}

export function deleteCatalog(id) {
  return tx([CATALOGS, META], 'readwrite', (t) => {
    t.objectStore(META).delete(id);
    return t.objectStore(CATALOGS).delete(id);
  });
}

export async function fetchDemoCatalog() {
  const [pdf, hotspots] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}sample/catalogo-demo.pdf`).then((r) => r.arrayBuffer()),
    fetch(`${import.meta.env.BASE_URL}sample/hotspots-demo.json`).then((r) => r.json()),
  ]);
  return { name: 'Catálogo demo', pdf, hotspots };
}
