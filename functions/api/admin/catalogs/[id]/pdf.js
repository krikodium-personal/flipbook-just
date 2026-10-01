// PUT /api/admin/catalogs/:id/pdf → sube o reemplaza el PDF (cuerpo = bytes del PDF, Content-Type application/pdf)
import { json, error, pdfKey, MAX_PDF_BYTES } from '../../../_lib/util.js';

export async function onRequestPut({ request, env, params }) {
  const row = await env.DB.prepare('SELECT id FROM catalogs WHERE id = ?').bind(params.id).first();
  if (!row) return error('No existe', 404);

  const size = Number(request.headers.get('Content-Length'));
  if (!size) return error('Falta el PDF');
  if (size > MAX_PDF_BYTES) return error('El PDF supera el tamaño máximo (95 MB)', 413);

  const bytes = await request.arrayBuffer();
  // Firma "%PDF-" al principio del archivo
  const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  if (String.fromCharCode(...head) !== '%PDF-') return error('El archivo no es un PDF', 415);

  await env.PDFS.put(pdfKey(params.id), bytes, { httpMetadata: { contentType: 'application/pdf' } });
  const now = Date.now();
  await env.DB.prepare('UPDATE catalogs SET pdf_size = ?, updated_at = ? WHERE id = ?').bind(bytes.byteLength, now, params.id).run();
  return json({ ok: true, size: bytes.byteLength, updatedAt: now });
}
