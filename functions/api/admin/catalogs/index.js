// GET  /api/admin/catalogs   → listado (resumen)
// POST /api/admin/catalogs   → crea un catálogo. Body JSON: { name, title?, pages?, cover?, hotspots?, source? ('directus' | 'arbell') }
//                               El PDF se sube después con PUT /api/admin/catalogs/:id/pdf
import { json, error, newId, toMeta, sanitizeHotspots, counts } from '../../_lib/util.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, title, pages, cover, products, links, created_at, updated_at FROM catalogs ORDER BY updated_at DESC',
  ).all();
  return json(results.map(toMeta));
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('JSON inválido');
  }
  const name = String(body.name ?? '').trim().slice(0, 200);
  if (!name) return error('Falta el nombre');
  let hotspots;
  try {
    hotspots = sanitizeHotspots(body.hotspots ?? []);
  } catch (e) {
    return error(e.message);
  }
  const now = Date.now();
  const id = newId();
  const c = counts(hotspots);
  await env.DB.prepare(
    `INSERT INTO catalogs (id, name, title, pages, cover, hotspots, products, links, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, name, body.title?.trim() || null, body.pages ?? null, coverOrNull(body.cover), JSON.stringify(hotspots), c.products, c.links, body.source === 'arbell' ? 'arbell' : 'directus', now, now)
    .run();
  return json({ id }, 201);
}

export function coverOrNull(v) {
  return typeof v === 'string' && v.startsWith('data:image/') && v.length < 400_000 ? v : null;
}
