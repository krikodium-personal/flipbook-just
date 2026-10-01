// Catálogos guardados en Cloudflare: configuración en D1 y PDF en R2, a través de la API (functions/api).
//   /api/admin/*   crear, editar y borrar (protegido con Cloudflare Access)
//   /api/public/*  lectura para el visor público
//
// Forma de un catálogo en el frontend:
//   { id, name, title, pages, cover, hotspots, createdAt, updatedAt, pdf?: ArrayBuffer }
// name = nombre del archivo PDF original · title = título elegido en el editor (null → se muestra name)

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof ArrayBuffer) {
    init.body = body;
    init.headers['Content-Type'] = 'application/pdf';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    const message = (await res.json().catch(() => null))?.error ?? `Error ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res;
}

const getJson = async (path) => (await request(path)).json();
const fetchPdf = async (id) => (await request(`/api/public/catalogs/${encodeURIComponent(id)}/pdf`)).arrayBuffer();

export const catalogTitle = (c) => c?.title?.trim() || c?.name || 'Catálogo';

export function listCatalogs() {
  return getJson('/api/admin/catalogs');
}

// Catálogo completo para el editor (incluye el PDF)
export async function getCatalog(id) {
  if (!id) return null;
  try {
    const [catalog, pdf] = await Promise.all([getJson(`/api/admin/catalogs/${encodeURIComponent(id)}`), fetchPdf(id)]);
    return { ...catalog, pdf };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Datos del visor público sin el PDF (el visor abre el PDF por URL con carga parcial)
export async function getPublicCatalogInfo(id) {
  if (!id) return null;
  try {
    return await getJson(`/api/public/catalogs/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export const publicPdfUrl = (id) => `/api/public/catalogs/${encodeURIComponent(id)}/pdf`;

// Lo que necesita el visor público (incluye el PDF)
export async function getPublicCatalog(id) {
  if (!id) return null;
  try {
    const [catalog, pdf] = await Promise.all([getJson(`/api/public/catalogs/${encodeURIComponent(id)}`), fetchPdf(id)]);
    return { ...catalog, pdf };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// { name, pdf, title?, pages?, cover?, hotspots? } → { id, ... }
export async function createCatalog({ pdf, ...data }) {
  const { id } = await (await request('/api/admin/catalogs', { method: 'POST', body: data })).json();
  try {
    await replacePdf(id, pdf);
  } catch (err) {
    await deleteCatalog(id).catch(() => {}); // no dejar un catálogo sin PDF
    throw err;
  }
  return { ...data, id };
}

// Guarda la configuración (no el PDF: para eso, replacePdf)
export async function saveCatalog(catalog) {
  const { updatedAt } = await (
    await request(`/api/admin/catalogs/${encodeURIComponent(catalog.id)}`, {
      method: 'PUT',
      body: {
        name: catalog.name,
        title: catalog.title ?? null,
        pages: catalog.pages ?? null,
        cover: catalog.cover ?? null,
        hotspots: catalog.hotspots,
        ...(catalog.outline !== undefined ? { outline: catalog.outline } : {}),
      },
    })
  ).json();
  catalog.updatedAt = updatedAt;
}

export async function patchMeta(id, patch) {
  await request(`/api/admin/catalogs/${encodeURIComponent(id)}`, { method: 'PUT', body: patch });
}

export async function replacePdf(id, pdf) {
  await request(`/api/admin/catalogs/${encodeURIComponent(id)}/pdf`, { method: 'PUT', body: pdf });
}

export async function deleteCatalog(id) {
  await request(`/api/admin/catalogs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchDemoCatalog() {
  const [pdf, hotspots] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}sample/catalogo-demo.pdf`).then((r) => r.arrayBuffer()),
    fetch(`${import.meta.env.BASE_URL}sample/hotspots-demo.json`).then((r) => r.json()),
  ]);
  return { name: 'Catálogo demo', pdf, hotspots };
}
