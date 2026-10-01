// GET    /api/admin/catalogs/:id  → catálogo completo (sin el PDF; el PDF va por /api/public/catalogs/:id/pdf)
// PUT    /api/admin/catalogs/:id  → guarda cambios. Body JSON parcial: { name?, title?, pages?, cover?, hotspots?, outline? }
// DELETE /api/admin/catalogs/:id  → borra la configuración y el PDF
import { json, error, toCatalog, sanitizeHotspots, sanitizeOutline, counts, pdfKey } from '../../_lib/util.js';
import { coverOrNull } from './index.js';

const find = (env, id) => env.DB.prepare('SELECT * FROM catalogs WHERE id = ?').bind(id).first();

export async function onRequestGet({ env, params }) {
  const row = await find(env, params.id);
  return row ? json(toCatalog(row)) : error('No existe', 404);
}

export async function onRequestPut({ request, env, params }) {
  const row = await find(env, params.id);
  if (!row) return error('No existe', 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return error('JSON inválido');
  }

  const sets = [];
  const values = [];
  const set = (col, val) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };
  if ('name' in body) set('name', String(body.name ?? '').trim().slice(0, 200) || row.name);
  if ('title' in body) set('title', typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : null);
  if ('pages' in body) set('pages', Number.isInteger(body.pages) ? body.pages : null);
  if ('cover' in body) set('cover', coverOrNull(body.cover));
  if ('hotspots' in body) {
    let hotspots;
    try {
      hotspots = sanitizeHotspots(body.hotspots);
    } catch (e) {
      return error(e.message);
    }
    const c = counts(hotspots);
    set('hotspots', JSON.stringify(hotspots));
    set('products', c.products);
    set('links', c.links);
  }
  if ('outline' in body) {
    try {
      const outline = sanitizeOutline(body.outline);
      set('outline', outline ? JSON.stringify(outline) : null);
    } catch (e) {
      return error(e.message);
    }
  }
  const now = Date.now();
  set('updated_at', now);
  await env.DB.prepare(`UPDATE catalogs SET ${sets.join(', ')} WHERE id = ?`).bind(...values, params.id).run();
  return json({ ok: true, updatedAt: now });
}

export async function onRequestDelete({ env, params }) {
  await env.PDFS.delete(pdfKey(params.id));
  await env.DB.prepare('DELETE FROM catalogs WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
