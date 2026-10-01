import { renderPdf, extractLayerText, renderCover, extractOutline } from './lib/pdf.js';
import { getCatalog, saveCatalog, replacePdf, catalogTitle } from './lib/store.js';
import { createProductSource } from './adapters/products.js';
import { $, esc, el, icon, toast, progressView, confirmDialog } from './lib/ui.js';
import { linkKind, normalizeUrl, urlHost } from './lib/links.js';

// Elementos de una página (catalog.hotspots):
//   producto: { id, page, x, y, code, sale }                     x, y = centro del "+" (0..1)
//   enlace:   { id, type: 'link', page, x, y, w, h, kind, target | url }   rectángulo (0..1) que lleva a la página
//             `target` del catálogo (kind 'page') o a la web `url` (kind 'url'), que se abre en otra pestaña
const products = createProductSource();
const state = { catalog: null, pages: [], current: 1, selected: null, codes: new Map(), tool: 'product' };

const isLink = (h) => h.type === 'link';
const MIN_SIZE = 0.02; // tamaño mínimo de un área (2% de la página)
const DEFAULT_AREA = { w: 0.24, h: 0.1 }; // área creada con un clic, sin arrastrar
// Capa del PDF donde diseño deja los códigos de producto; cada texto de la capa se convierte en un "+"
const PRODUCT_LAYER = 'Products ID';

document.querySelectorAll('[data-icon]').forEach((n) => n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon)));
markAdminBrowser();
startWhenDesktop();

// El editor es solo para computadora: en pantallas chicas se muestra un aviso y no se carga nada
// (ni el PDF ni sus páginas). Si la pantalla se agranda (girar una tablet, ensanchar la ventana), arranca.
function startWhenDesktop() {
  const small = window.matchMedia('(max-width: 899px)');
  const id = new URLSearchParams(location.search).get('id');
  if (id) $('#mobile-viewer-link').href = `/catalogo.html?id=${encodeURIComponent(id)}`;
  else $('#mobile-viewer-link').hidden = true;
  if (!small.matches) return init();
  const onChange = () => {
    if (small.matches) return;
    small.removeEventListener('change', onChange);
    init();
  };
  small.addEventListener('change', onChange);
}

// Marca este navegador como de administración: el visor muestra el link "Editor"
function markAdminBrowser() {
  try {
    localStorage.setItem('flipbook-admin', '1');
  } catch {}
}

async function init() {
  const list = await products.list().catch(() => []);
  state.codes = new Map(list.map((p) => [p.code, p.name]));
  $('#codes').innerHTML = list.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('');

  $('#pdf-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (file) updatePdf(file);
  });
  document.addEventListener('keydown', onKey);

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) return location.replace('/admin/');
  const notice = (msg) =>
    ($('#root').innerHTML = `<div class="stage"><div class="loading"><p>${esc(msg)}</p><a class="btn dark sm" href="/admin/">Ver todos los catálogos</a></div></div>`);
  let catalog;
  try {
    catalog = await getCatalog(id);
  } catch (err) {
    return notice(`No se pudo cargar el catálogo: ${err.message}`);
  }
  if (!catalog) return notice('Este catálogo no existe o fue eliminado.');
  $('#viewer-link').href = `/catalogo.html?id=${encodeURIComponent(id)}`;
  await open(catalog);
  // Catálogo recién creado desde el inicio: leer los códigos de la capa del PDF
  if (params.has('detect')) {
    history.replaceState(null, '', `?id=${encodeURIComponent(id)}`);
    await detectCodes({ quietIfMissing: true });
  }
}

// Reemplaza el PDF del catálogo (nueva versión del mismo catálogo). Se conservan el título, los enlaces y los
// productos cargados a mano; los productos que vinieron de la capa PRODUCT_LAYER se vuelven a leer del PDF nuevo.
async function updatePdf(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return toast('El archivo no es un PDF', { error: true });
  const fromLayer = state.catalog.hotspots.filter((h) => h.source === 'pdf-layer').length;
  const kept = state.catalog.hotspots.length - fromLayer;
  const ok = await confirmDialog(
    `Se mantienen el título${kept ? ` y ${kept} elementos cargados a mano (enlaces y productos)` : ''}.` +
      `${fromLayer ? ` Los ${fromLayer} productos de la capa “${PRODUCT_LAYER}” se vuelven a leer del PDF nuevo.` : ''}` +
      ` Si el PDF nuevo tiene menos páginas, se quitan los elementos de las páginas que ya no existen.`,
    { title: `Actualizar PDF con “${file.name}”`, confirmLabel: 'Actualizar' },
  );
  if (!ok) return;

  const pdf = await file.arrayBuffer();
  let meta;
  try {
    meta = await renderCover(pdf);
  } catch (err) {
    return toast(`No se pudo leer el PDF: ${err.message}`, { error: true });
  }
  const c = state.catalog;
  toast('Subiendo el PDF nuevo…');
  try {
    await replacePdf(c.id, pdf);
  } catch (err) {
    return toast(`No se pudo subir el PDF: ${err.message}`, { error: true });
  }
  c.pdf = pdf;
  c.name = file.name.replace(/\.pdf$/i, '');
  c.pages = meta.pages;
  c.cover = meta.cover;
  c.hotspots = c.hotspots.filter((h) => h.source !== 'pdf-layer' && h.page <= meta.pages);
  await saveCatalog(c);
  await open(c);
  await detectCodes({ quietIfMissing: true });
}

// Crea un "+" por cada código de la capa PRODUCT_LAYER. No duplica: si ya hay un "+" con el mismo código
// cerca en la misma página, lo saltea.
async function detectCodes({ quietIfMissing = false } = {}) {
  const btn = $('#detect');
  const label = btn?.innerHTML;
  if (btn) btn.disabled = true;
  try {
    const res = await extractLayerText(state.catalog.pdf, PRODUCT_LAYER, {
      onProgress: (n, total) => btn && (btn.textContent = `Buscando códigos… ${n}/${total}`),
    });
    if (!res.found) {
      if (!quietIfMissing) toast(`El PDF no tiene una capa llamada “${PRODUCT_LAYER}”`, { error: true });
      return;
    }
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.03;
    let added = 0;
    const unknown = new Set();
    for (const it of res.items) {
      const exists = state.catalog.hotspots.some((h) => !isLink(h) && h.page === it.page && h.code === it.text && near(h, it));
      if (exists) continue;
      state.catalog.hotspots.push({
        id: `h${Date.now().toString(36)}${added}`,
        page: it.page,
        x: round(it.x),
        y: round(it.y),
        code: it.text,
        source: 'pdf-layer',
      });
      added++;
      if (!state.codes.has(it.text)) unknown.add(it.text);
    }
    persist();
    render();
    const skipped = res.skippedPages.length ? ` · ${res.skippedPages.length} páginas no se pudieron leer` : '';
    toast(
      added
        ? `${added} productos agregados desde la capa “${PRODUCT_LAYER}”${unknown.size ? ` · ${unknown.size} códigos no están en Directus` : ''}${skipped}`
        : `No hay códigos nuevos en la capa “${PRODUCT_LAYER}”${skipped}`,
    );
  } catch (err) {
    toast(`No se pudieron leer los códigos del PDF: ${err.message}`, { error: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }
}

async function open(catalog) {
  state.catalog = catalog;
  state.pages.forEach((p) => URL.revokeObjectURL(p.url));
  renderTitle();
  const progress = progressView('Procesando PDF…');
  $('#root').replaceChildren(el('<div class="stage"></div>'));
  $('#root .stage').append(progress.node);
  state.pages = await renderPdf(catalog.pdf, { targetHeight: 1200, onProgress: progress.update });
  state.current = 1;
  state.selected = null;
  // Índice de contenidos ya resuelto a páginas: el visor lo usa sin recorrer el PDF (que baja por partes)
  extractOutline(catalog.pdf)
    .then((outline) => {
      if (JSON.stringify(outline) === JSON.stringify(catalog.outline ?? null)) return;
      catalog.outline = outline;
      persist();
    })
    .catch(() => {});
  // Catálogos viejos o migrados: completar datos del listado
  if (!catalog.pages || !catalog.cover) {
    renderCover(catalog.pdf)
      .then(({ cover, pages }) => {
        Object.assign(catalog, { cover, pages });
        persist();
      })
      .catch(() => {});
  }

  $('#root').replaceChildren(
    el(`<div class="editor">
      <nav class="thumbs" id="thumbs"></nav>
      <section class="canvas-area">
        <div class="toolbar" role="radiogroup" aria-label="Herramienta">
          <button class="tool" data-tool="product" role="radio">${icon('plus')}Producto</button>
          <button class="tool" data-tool="link" role="radio">${icon('area')}Área → página</button>
        </div>
        <div class="spread" id="spread"></div>
      </section>
      <aside class="side" id="side"></aside>
    </div>`),
  );
  document.querySelectorAll('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      state.tool = b.dataset.tool;
      renderToolbar();
      renderSide();
    }),
  );
  render();
}

// ---------- Páginas enfrentadas (escritorio) ----------
// Como el catálogo impreso: contratapa + tapa, 2+3, 4+5… En pantallas angostas, una página por vez.
const spreadQuery = window.matchMedia('(min-width: 1100px)');
spreadQuery.addEventListener('change', () => state.catalog && render());

function viewPages(n = state.current) {
  const total = state.pages.length;
  if (!spreadQuery.matches || total < 3) return [n];
  if (n === 1 || n === total) return [total, 1];
  const left = n % 2 === 0 ? n : n - 1;
  return left + 1 <= total - 1 ? [left, left + 1] : [left];
}

function viewLabel(pages) {
  const total = state.pages.length;
  if (pages.length === 1) return `Página ${pages[0]} de ${total}`;
  if (pages.includes(1) && pages.includes(total)) return `Contratapa y tapa (${total} y 1)`;
  return `Páginas ${pages[0]} y ${pages[1]} de ${total}`;
}

// ---------- Título del catálogo ----------
// catalog.title es el título que ve el cliente; catalog.name queda como nombre del archivo PDF original.

function renderTitle() {
  const t = $('#title');
  t.innerHTML = `<span class="title-prefix">Editor ·</span>
    <button class="title-btn" id="title-btn" title="Cambiar el título · PDF: ${esc(state.catalog.name)}.pdf">
      <span>${esc(catalogTitle(state.catalog))}</span>${icon('edit')}
    </button>`;
  $('#title-btn').addEventListener('click', editTitle);
}

function editTitle() {
  const form = $('#title-form');
  const input = $('#title-input');
  input.value = catalogTitle(state.catalog);
  $('#title').hidden = true;
  form.hidden = false;
  input.focus();
  input.select();

  const finish = (save) => {
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keydown', onKey);
    form.removeEventListener('submit', onSubmit);
    if (save) {
      const value = input.value.replace(/\s+/g, ' ').trim();
      // Vacío = volver al nombre del PDF
      state.catalog.title = value && value !== state.catalog.name ? value : null;
      persist();
    }
    form.hidden = true;
    $('#title').hidden = false;
    renderTitle();
  };
  const onSubmit = (e) => {
    e.preventDefault();
    finish(true);
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish(false);
    }
  };
  form.addEventListener('submit', onSubmit);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKey);
}

// ---------- Render ----------
function render() {
  renderToolbar();
  renderThumbs();
  renderPage();
  renderSide();
}

function renderToolbar() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-checked', b.dataset.tool === state.tool));
  document.querySelectorAll('.edit-page').forEach((p) => (p.dataset.tool = state.tool));
}

function goToPage(n) {
  state.current = n;
  state.selected = null;
  render();
  document.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' });
}

function renderThumbs() {
  $('#thumbs').replaceChildren(
    ...state.pages.map((p) => {
      const count = state.catalog.hotspots.filter((h) => h.page === p.n).length;
      const b = el(`<button class="thumb${viewPages().includes(p.n) ? ' active' : ''}" aria-label="Página ${p.n}">
        <img src="${p.url}" alt=""><small>${p.n}${count ? ` · <b>${count}</b>` : ''}</small></button>`);
      b.addEventListener('click', () => goToPage(p.n));
      return b;
    }),
  );
}

function renderPage() {
  const spread = $('#spread');
  const pages = viewPages();
  spread.classList.toggle('two', pages.length === 2);
  spread.replaceChildren(
    ...pages.map((n) => {
      const pageEl = el(`<div class="edit-page" data-page="${n}" data-tool="${state.tool}">
          <img class="page-img" src="${state.pages[n - 1].url}" alt="Página ${n}" draggable="false">
          ${pages.length === 2 ? `<span class="page-num">${n}</span>` : ''}
        </div>`);
      pageEl.addEventListener('pointerdown', onPagePointerDown);
      const onPage = state.catalog.hotspots.filter((h) => h.page === n);
      // Áreas primero, así los "+" quedan por encima
      for (const h of onPage.filter(isLink)) pageEl.append(linkAreaEl(h, pageEl));
      for (const h of onPage.filter((x) => !isLink(x))) {
        const known = state.codes.has(h.code);
        const btn = el(`<button class="hotspot${h.sale ? ' sale' : ''}${h.id === state.selected ? ' selected' : ''}${known ? '' : ' unknown'}"
          style="left:${h.x * 100}%;top:${h.y * 100}%" title="${esc(h.code || 'sin código')}">${icon(h.sale ? 'percent' : 'plus')}</button>`);
        enableDrag(btn, h, pageEl);
        pageEl.append(btn);
      }
      return pageEl;
    }),
  );
}

function linkAreaEl(h, pageEl) {
  const valid = linkValid(h);
  const area = el(`<div class="link-area${h.id === state.selected ? ' selected' : ''}${valid ? '' : ' invalid'}${linkKind(h) === 'url' ? ' external' : ''}"
      style="${areaStyle(h)}" title="${esc(linkDescription(h))}">
      <span class="link-label">${icon(linkKind(h) === 'url' ? 'external' : 'link')}${esc(linkShortLabel(h))}</span>
      ${['nw', 'ne', 'sw', 'se'].map((c) => `<span class="handle" data-corner="${c}"></span>`).join('')}
    </div>`);
  enableAreaEdit(area, h, pageEl);
  return area;
}

const areaStyle = (h) => `left:${h.x * 100}%;top:${h.y * 100}%;width:${h.w * 100}%;height:${h.h * 100}%`;
const validTarget = (t) => Number.isInteger(t) && t >= 1 && t <= state.pages.length;
const linkValid = (h) => (linkKind(h) === 'url' ? Boolean(normalizeUrl(h.url)) : validTarget(h.target));
const linkShortLabel = (h) =>
  linkKind(h) === 'url' ? (linkValid(h) ? urlHost(h.url) : '¿web?') : linkValid(h) ? `p. ${h.target}` : '¿página?';
const linkDescription = (h) =>
  linkKind(h) === 'url'
    ? linkValid(h)
      ? `Abre ${h.url}`
      : 'Web sin dirección'
    : linkValid(h)
      ? `Enlace a la página ${h.target}`
      : 'Enlace sin destino';

// Fila de la lista lateral de elementos de la página
function listItem(h) {
  if (isLink(h)) {
    const text = linkKind(h) === 'url' && linkValid(h) ? `Web: ${urlHost(h.url)}` : linkDescription(h);
    return `<code>${icon(linkKind(h) === 'url' ? 'external' : 'link')}</code><span class="nm${linkValid(h) ? '' : ' bad'}">${esc(text)}</span><span></span>`;
  }
  const name = state.codes.get(h.code);
  return `<code>${esc(h.code || '—')}</code><span class="nm${name ? '' : ' bad'}">${esc(name ?? (h.code ? 'Código desconocido' : 'Sin código'))}</span>${h.sale ? '<span class="sale-tag">%</span>' : '<span></span>'}`;
}

function renderSide() {
  const side = $('#side');
  const pages = viewPages();
  const list = hotspotsInView();
  const sel = state.catalog.hotspots.find((h) => h.id === state.selected);
  // Con dos páginas a la vista, cada fila indica de qué página es
  const item = (h) => (pages.length > 1 ? listItem(h).replace('<span class="nm', `<span class="pg">p. ${h.page}</span><span class="nm`) : listItem(h));
  const totals = state.catalog.hotspots.reduce((t, h) => (isLink(h) ? t.links++ : t.products++, t), { products: 0, links: 0 });
  const hint =
    state.tool === 'link'
      ? 'Arrastrá sobre la página para dibujar un área. Movela arrastrándola y cambiá su tamaño desde las esquinas.'
      : 'Hacé clic sobre la página para agregar un <b>+</b> y arrastralo para moverlo.';

  side.innerHTML = `
    <div>
      <span class="eyebrow">${viewLabel(pages)}</span>
      <h3>Elementos ${pages.length > 1 ? 'de las páginas' : 'de la página'}</h3>
      <p class="hint">${hint}</p>
    </div>
    ${sel ? (isLink(sel) ? linkCard(sel) : productCard(sel)) : ''}
    <ul class="hs-list">${
      list.length
        ? list.map((h) => `<li data-id="${h.id}" class="${h.id === state.selected ? 'selected' : ''}">${item(h)}</li>`).join('')
        : `<li class="empty">Todavía no hay elementos en ${pages.length > 1 ? 'estas páginas' : 'esta página'}.</li>`
    }</ul>
    <div class="stack">
      <button class="btn secondary sm" id="detect" title="Crea un + por cada código de la capa “${PRODUCT_LAYER}” del PDF">${icon('scan')}Detectar códigos del PDF</button>
      <button class="btn secondary sm" id="export">${icon('download')}Exportar hotspots</button>
      <label class="btn secondary sm">${icon('upload')}Importar hotspots<input type="file" id="import" accept="application/json" hidden></label>
    </div>
    <p class="side-foot">${totals.products} productos y ${totals.links} enlaces en total · se guarda automáticamente.</p>`;

  side.querySelectorAll('.hs-list li[data-id]').forEach((li) =>
    li.addEventListener('click', () => {
      state.selected = li.dataset.id;
      render();
    }),
  );
  if (sel && isLink(sel)) bindLinkCard(sel);
  else if (sel) bindProductCard(sel, item);
  $('#detect').addEventListener('click', () => detectCodes());
  $('#export').addEventListener('click', exportHotspots);
  $('#import').addEventListener('change', (e) => e.target.files[0] && importHotspots(e.target.files[0]));
}

function productCard(sel) {
  return `<div class="card selected-card">
    <label class="field">Producto (código, slug o #id)
      <input id="code" list="codes" value="${esc(sel.code)}" placeholder="ej. 1014" autocomplete="off">
    </label>
    <p id="code-name" class="match"></p>
    <label class="toggle"><input type="checkbox" id="sale"${sel.sale ? ' checked' : ''}>
      <span class="dot">${icon('percent')}</span>En oferta</label>
    <button class="btn secondary sm" id="delete">${icon('trash')}Eliminar este +</button>
  </div>`;
}

function bindProductCard(sel, item) {
  const input = $('#code');
  const showName = () => {
    const name = state.codes.get(input.value.trim());
    const out = $('#code-name');
    out.className = `match${name ? ' ok' : input.value ? ' bad' : ''}`;
    out.innerHTML = name ? `${icon('check')}${esc(name)}` : input.value ? `${icon('alert')}No existe en Directus` : '';
  };
  input.addEventListener('input', () => {
    sel.code = input.value.trim();
    showName();
    const li = $(`#side .hs-list li[data-id="${sel.id}"]`);
    if (li) li.innerHTML = item(sel);
    persist();
    renderPage();
  });
  input.addEventListener('change', () => renderSide());
  showName();
  if (!sel.code) input.focus();
  $('#sale').addEventListener('change', (e) => {
    sel.sale = e.target.checked;
    persist();
    render();
  });
  $('#delete').addEventListener('click', () => removeSelected());
}

function linkCard(sel) {
  const kind = linkKind(sel);
  const ok = validTarget(sel.target);
  const preview = ok ? state.pages[sel.target - 1] : null;
  return `<div class="card selected-card">
    <div>
      <div class="option-label">Al tocar el área</div>
      <div class="segmented" role="radiogroup" aria-label="Destino del enlace">
        <button role="radio" data-kind="page" aria-checked="${kind === 'page'}">${icon('link')}Página</button>
        <button role="radio" data-kind="url" aria-checked="${kind === 'url'}">${icon('external')}Web externa</button>
      </div>
    </div>
    ${
      kind === 'page'
        ? `<label class="field">Lleva a la página
            <div class="target-row">
              <input id="target" type="number" inputmode="numeric" min="1" max="${state.pages.length}" value="${sel.target ?? ''}" placeholder="ej. 12">
              <span class="meta">de ${state.pages.length}</span>
            </div>
          </label>
          <button class="target-preview" id="target-preview" ${ok ? '' : 'disabled'} title="Ver esa página en el editor">
            ${preview ? `<img src="${preview.url}" alt="Página ${sel.target}"><span>${icon('eye')}Ver página ${sel.target}</span>` : `<span class="meta">Elegí una página de destino</span>`}
          </button>`
        : `<label class="field">Dirección web
            <input id="url" type="url" inputmode="url" value="${esc(sel.url ?? '')}" placeholder="ej. justargentina.com/tienda" autocomplete="off" spellcheck="false">
          </label>
          <p id="url-check" class="match"></p>
          <p class="hint">Se abre en una pestaña nueva, así el catálogo queda abierto.</p>`
    }
    <button class="btn secondary sm" id="delete">${icon('trash')}Eliminar esta área</button>
  </div>`;
}

function bindLinkCard(sel) {
  document.querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      if (linkKind(sel) === b.dataset.kind) return;
      sel.kind = b.dataset.kind;
      persist();
      render();
    }),
  );
  $('#delete').addEventListener('click', () => removeSelected());

  if (linkKind(sel) === 'url') {
    const input = $('#url');
    const check = () => {
      const href = normalizeUrl(input.value);
      const out = $('#url-check');
      out.className = `match${href ? ' ok' : input.value.trim() ? ' bad' : ''}`;
      out.innerHTML = href
        ? `${icon('check')}<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href)}</a>`
        : input.value.trim()
          ? `${icon('alert')}No es una dirección web válida`
          : '';
      return href;
    };
    input.addEventListener('input', check);
    input.addEventListener('change', () => {
      const href = check();
      sel.url = href ?? input.value.trim();
      if (href) input.value = href;
      persist();
      renderPage();
      const li = $(`#side .hs-list li[data-id="${sel.id}"]`);
      if (li) li.innerHTML = listItem(sel);
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    check();
    if (!linkValid(sel)) input.focus();
    return;
  }

  const input = $('#target');
  input.addEventListener('change', () => {
    const n = parseInt(input.value, 10);
    sel.target = Number.isFinite(n) ? Math.min(Math.max(n, 1), state.pages.length) : null;
    persist();
    render();
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  if (!validTarget(sel.target)) input.focus();
  $('#target-preview').addEventListener('click', () => validTarget(sel.target) && goToPage(sel.target));
}

// ---------- Interacción sobre la página ----------
function pagePoint(e, pageEl) {
  const rect = pageEl.querySelector('.page-img').getBoundingClientRect();
  return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
}

function onPagePointerDown(e) {
  if (e.button !== 0 || e.target.closest('.hotspot, .link-area')) return;
  e.preventDefault();
  const wrap = e.currentTarget;
  const page = Number(wrap.dataset.page);
  const start = pagePoint(e, wrap);
  capture(wrap, e);

  let ghost = null;
  let end = start;
  const dragged = () => Math.abs(end.x - start.x) > 0.01 || Math.abs(end.y - start.y) > 0.01;

  const move = (ev) => {
    end = pagePoint(ev, wrap);
    if (state.tool !== 'link' || !dragged()) return;
    if (!ghost) {
      ghost = el('<div class="link-area drawing"></div>');
      wrap.append(ghost);
    }
    ghost.setAttribute('style', areaStyle(rectFrom(start, end)));
  };
  const up = () => {
    wrap.removeEventListener('pointermove', move);
    wrap.removeEventListener('pointerup', up);
    ghost?.remove();
    const id = `h${Date.now().toString(36)}`;
    let h;
    if (state.tool === 'link') {
      const r = dragged()
        ? rectFrom(start, end)
        : fitRect({ x: start.x - DEFAULT_AREA.w / 2, y: start.y - DEFAULT_AREA.h / 2, ...DEFAULT_AREA });
      h = { id, type: 'link', page, ...roundRect(r), target: null };
    } else {
      if (dragged()) return;
      h = { id, page, x: round(start.x), y: round(start.y), code: '' };
    }
    state.catalog.hotspots.push(h);
    state.selected = h.id;
    persist();
    render();
  };
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerup', up);
}

function rectFrom(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(MIN_SIZE, Math.abs(a.x - b.x)), h: Math.max(MIN_SIZE, Math.abs(a.y - b.y)) };
}

// Mantiene el rectángulo dentro de la página
function fitRect({ x, y, w, h }) {
  w = Math.min(1, Math.max(MIN_SIZE, w));
  h = Math.min(1, Math.max(MIN_SIZE, h));
  return { x: Math.min(Math.max(0, x), 1 - w), y: Math.min(Math.max(0, y), 1 - h), w, h };
}

// setPointerCapture puede fallar (p. ej. si el puntero ya se soltó); no debe cortar la interacción
function capture(node, e) {
  try {
    node.setPointerCapture(e.pointerId);
  } catch {}
}

const roundRect = (r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) });

function enableDrag(btn, h, pageEl) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    capture(btn, e);
    let moved = false;
    const move = (ev) => {
      moved = true;
      const p = pagePoint(ev, pageEl);
      h.x = round(p.x);
      h.y = round(p.y);
      btn.style.left = `${h.x * 100}%`;
      btn.style.top = `${h.y * 100}%`;
    };
    const up = () => {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      state.selected = h.id;
      if (moved) persist();
      render();
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
  });
}

// Mover el área arrastrándola o redimensionarla desde una esquina
function enableAreaEdit(area, h, pageEl) {
  area.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    capture(area, e);
    const corner = e.target.dataset?.corner;
    const start = pagePoint(e, pageEl);
    const orig = { x: h.x, y: h.y, w: h.w, h: h.h };
    let moved = false;

    const move = (ev) => {
      const p = pagePoint(ev, pageEl);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.abs(dx) < 0.003 && Math.abs(dy) < 0.003) return;
      moved = true;
      let r;
      if (!corner) {
        r = fitRect({ ...orig, x: orig.x + dx, y: orig.y + dy });
      } else {
        // La esquina opuesta queda fija
        const left = corner.includes('w') ? orig.x + dx : orig.x;
        const right = corner.includes('e') ? orig.x + orig.w + dx : orig.x + orig.w;
        const top = corner.includes('n') ? orig.y + dy : orig.y;
        const bottom = corner.includes('s') ? orig.y + orig.h + dy : orig.y + orig.h;
        r = rectFrom({ x: clamp(left), y: clamp(top) }, { x: clamp(right), y: clamp(bottom) });
      }
      Object.assign(h, roundRect(r));
      area.setAttribute('style', areaStyle(h));
    };
    const up = () => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerup', up);
      state.selected = h.id;
      if (moved) persist();
      render();
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', up);
  });
}

function removeSelected() {
  if (!state.selected) return;
  state.catalog.hotspots = state.catalog.hotspots.filter((h) => h.id !== state.selected);
  state.selected = null;
  persist();
  render();
}

function onKey(e) {
  if (!state.catalog || e.target.matches?.('input, textarea, select') || document.querySelector('.overlay')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
    e.preventDefault();
    removeSelected();
  }
  if (e.key === 'Escape' && state.selected) {
    state.selected = null;
    render();
  }
}

function exportHotspots() {
  const blob = new Blob([JSON.stringify(state.catalog.hotspots, null, 2)], { type: 'application/json' });
  const a = el(`<a download="${esc(state.catalog.name)}-hotspots.json"></a>`);
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importHotspots(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every((h) => h.page && 'x' in h && 'y' in h)) throw new Error('formato inválido');
    state.catalog.hotspots = data.map((h, i) => {
      const base = { id: h.id ?? `h${i}`, page: h.page, x: h.x, y: h.y };
      return isLink(h)
        ? {
            ...base,
            type: 'link',
            w: h.w,
            h: h.h,
            kind: linkKind(h),
            target: Number.isInteger(h.target) ? h.target : null,
            url: normalizeUrl(h.url) ?? '',
          }
        : { ...base, code: String(h.code ?? ''), sale: Boolean(h.sale) };
    });
    state.selected = null;
    persist();
    render();
    toast(`${data.length} elementos importados`);
  } catch (err) {
    toast(`No se pudo importar: ${err.message}`, { error: true });
  }
}

// Guardado automático en Cloudflare (agrupa cambios seguidos en un solo envío)
let saveTimer;
let saving = Promise.resolve();
function persist() {
  clearTimeout(saveTimer);
  setSaveState('pending');
  saveTimer = setTimeout(() => {
    saving = saving
      .then(() => saveCatalog(state.catalog))
      .then(() => setSaveState('saved'))
      .catch((e) => {
        setSaveState('error');
        toast(`No se pudo guardar: ${e.message}`, { error: true });
      });
  }, 600);
}

function setSaveState(s) {
  const node = $('#save-state');
  if (!node) return;
  node.dataset.state = s;
  node.textContent = { pending: 'Guardando…', saved: 'Guardado', error: 'Sin guardar' }[s];
}

// Evita cerrar la pestaña con cambios sin enviar
window.addEventListener('beforeunload', (e) => {
  if ($('#save-state')?.dataset.state === 'pending') e.preventDefault();
});

const hotspotsInView = () => {
  const pages = viewPages();
  return state.catalog.hotspots.filter((h) => pages.includes(h.page)).sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page));
};
const clamp = (v) => Math.max(0, Math.min(1, v));
const round = (v) => Math.round(v * 10000) / 10000;
