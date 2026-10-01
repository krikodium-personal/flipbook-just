import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Renderiza cada página del PDF a una imagen (object URL).
// En producción esto se haría una sola vez al subir el PDF y las imágenes quedarían en un CDN.
export async function renderPdf(bytes, { targetHeight = 1600, onProgress } = {}) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push(await renderPage(pdf, n, { targetHeight }));
    onProgress?.(n, pdf.numPages);
  }
  await task.destroy();
  return pages;
}

// Abre un PDF por URL con carga parcial: solo se bajan los rangos de bytes que hacen falta para cada página
// (el servidor tiene que aceptar Range). Así el visor muestra la primera página sin bajar los 20 MB.
//
// Se usa un transporte propio en vez de getDocument({ url }): pdf.js con url arranca siempre con un pedido del
// archivo completo para detectar si el servidor acepta rangos, y ese pedido termina bajando todo igual.
const CHUNK = 128 * 1024;

export async function openPdf(url) {
  // Primer trozo: trae el encabezado (en PDFs linealizados, también lo de la primera página) y el tamaño total
  const first = await fetchRange(url, 0, CHUNK);
  const length = Number(first.headers.get('Content-Range')?.split('/')[1]);
  const initial = new Uint8Array(await first.arrayBuffer());
  if (!length) throw new Error('El servidor no informó el tamaño del PDF');

  const transport = new pdfjsLib.PDFDataRangeTransport(length, initial);
  transport.requestDataRange = (begin, end) => {
    fetchRange(url, begin, end)
      .then((r) => r.arrayBuffer())
      .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)))
      .catch((err) => console.warn('No se pudo bajar una parte del PDF', err));
  };
  const task = pdfjsLib.getDocument({ range: transport, length, rangeChunkSize: CHUNK, disableAutoFetch: true });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

async function fetchRange(url, begin, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
  if (res.status !== 206) throw new Error(`El servidor no aceptó la carga parcial (${res.status})`);
  return res;
}

// Renderiza una página a imagen (object URL)
export async function renderPage(doc, n, { targetHeight = 1600 } = {}) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetHeight / base.height });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  page.cleanup();
  return { n, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

// Proporción ancho/alto de una página sin renderizarla
export async function pageRatio(doc, n = 1) {
  const page = await doc.getPage(n);
  const { width, height } = page.getViewport({ scale: 1 });
  return { width, height };
}

// Extrae el texto de una capa (Optional Content Group) del PDF, con su posición relativa en la página.
// Uso: códigos de producto que diseño deja en una capa oculta (ej. "Products ID") para ubicar los hotspots.
//
// pdf.js no dice a qué capa pertenece cada texto en getTextContent (el id de la marca OC viene vacío), pero sí
// en la lista de operadores de dibujo. Ambas recorren el contenido en el mismo orden, así que se cruzan las
// marcas de contenido (BDC/BMC) por posición. Si en una página no coincide la cantidad, esa página se omite.
export async function extractLayerText(bytes, layerName, { onProgress } = {}) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  const result = { found: false, items: [], skippedPages: [] };
  try {
    const occ = await pdf.getOptionalContentConfig();
    const wanted = new Set();
    for (const [id, group] of occ) if (normalize(group.name) === normalize(layerName)) wanted.add(id);
    if (!wanted.size) return result;
    result.found = true;

    const { OPS } = pdfjsLib;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const ops = await page.getOperatorList();
      const markIds = [];
      ops.fnArray.forEach((fn, i) => {
        if (fn === OPS.beginMarkedContentProps) {
          const [tag, props] = ops.argsArray[i];
          markIds.push(tag === 'OC' ? (props?.id ?? null) : null);
        } else if (fn === OPS.beginMarkedContent) markIds.push(null);
      });

      const text = await page.getTextContent({ includeMarkedContent: true });
      const begins = text.items.filter((it) => it.type?.startsWith('beginMarkedContent')).length;
      if (begins !== markIds.length) {
        result.skippedPages.push(n);
      } else {
        const viewport = page.getViewport({ scale: 1 });
        const stack = [];
        let k = 0;
        for (const it of text.items) {
          if (it.type?.startsWith('beginMarkedContent')) stack.push(markIds[k++]);
          else if (it.type === 'endMarkedContent') stack.pop();
          else if (it.str?.trim() && stack.some((id) => wanted.has(id))) {
            // Centro del texto, en coordenadas de pantalla (origen arriba a la izquierda)
            const [cx, cy] = viewport.convertToViewportPoint(it.transform[4] + it.width / 2, it.transform[5] + it.height / 2);
            result.items.push({ page: n, text: it.str.trim(), x: cx / viewport.width, y: cy / viewport.height });
          }
        }
      }
      page.cleanup();
      onProgress?.(n, pdf.numPages);
    }
    return result;
  } finally {
    await task.destroy();
  }
}

const normalize = (s) => String(s ?? '').trim().toLowerCase();

// Marcadores (outline) del PDF → árbol [{ title, page, children }]. Así el menú de contenidos sale del mismo PDF
// que exporta diseño (InDesign/Illustrator), sin cargarlo a mano.
export async function extractOutline(bytes) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  try {
    return await outlineOf(pdf);
  } finally {
    await task.destroy();
  }
}

// Igual que extractOutline, sobre un documento ya abierto (visor con carga parcial)
export async function outlineOf(pdf) {
  const outline = await pdf.getOutline();
  const pageOf = async (dest) => {
    try {
      const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      return d ? (await pdf.getPageIndex(d[0])) + 1 : null;
    } catch {
      return null;
    }
  };
  const walk = async (items = []) => {
    const out = [];
    for (const it of items) {
      const node = {
        title: String(it.title ?? '').replace(/\s+/g, ' ').trim(),
        page: await pageOf(it.dest),
        children: await walk(it.items),
      };
      if (node.title && (node.page || node.children.length)) out.push(node);
    }
    return out;
  };
  return outline ? await walk(outline) : [];
}

// Portada chica (JPEG en data URL) + cantidad de páginas, para el listado de catálogos
export async function renderCover(bytes, { height = 420 } = {}) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: height / base.height });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return { cover: canvas.toDataURL('image/jpeg', 0.8), pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
