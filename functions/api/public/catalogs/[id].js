// GET /api/public/catalogs/:id → lo que necesita el visor público: título, páginas, hotspots e índice.
// No expone el nombre del archivo ni fechas.
import { json, error, parseOutline } from '../../_lib/util.js';

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare('SELECT id, name, title, pages, hotspots, outline, updated_at FROM catalogs WHERE id = ?').bind(params.id).first();
  if (!row) return error('No existe', 404);
  return json(
    {
      id: row.id,
      title: row.title || row.name,
      pages: row.pages,
      hotspots: JSON.parse(row.hotspots || '[]'),
      outline: parseOutline(row.outline), // null: todavía no calculado (el visor lo arma del PDF)
      version: row.updated_at,
    },
    200,
    { 'Cache-Control': 'no-cache' },
  );
}
