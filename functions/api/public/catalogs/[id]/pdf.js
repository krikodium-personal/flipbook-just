// GET /api/public/catalogs/:id/pdf → el PDF desde R2 (lo usan el visor y el editor)
//
// Soporta pedidos por rango (Range: bytes=…): el visor abre el PDF con pdf.js en modo de carga parcial y baja solo
// las partes que necesita para cada página, en vez de los 20 MB completos antes de mostrar nada.
import { error, pdfKey } from '../../../_lib/util.js';

export async function onRequestGet({ request, env, params }) {
  const key = pdfKey(params.id);
  const hasRange = request.headers.has('Range');
  const obj = await env.PDFS.get(key, {
    onlyIf: hasRange ? undefined : request.headers,
    range: hasRange ? request.headers : undefined,
  });
  if (!obj) return error('No existe', 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  // Revalida siempre: si se actualizó el PDF, el visor lo ve enseguida; si no cambió, responde 304 sin bajarlo
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });

  if (hasRange && obj.range) {
    const { offset, length } = resolveRange(obj.range, obj.size);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
}

// R2 devuelve el rango pedido como { offset, length } o { suffix } (últimos N bytes)
function resolveRange(range, size) {
  if ('suffix' in range && range.suffix != null) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  const length = range.length ?? size - offset;
  return { offset, length };
}
