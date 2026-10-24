import { PageFlip } from 'page-flip';
import { MobilePager } from './lib/mobile-pager.js';
import { openPdf, renderPage, pageRatio, outlineOf } from './lib/pdf.js';
import { getPublicCatalogInfo, publicPdfUrl, catalogTitle } from './lib/store.js';
import { createProductSource } from './adapters/products.js';
import { createCart, formatMoney } from './adapters/shopify.js';
import { $, esc, el, icon, toast, progressView } from './lib/ui.js';
import { linkKind, normalizeUrl, urlHost } from './lib/links.js';

let products = createProductSource(); // se reemplaza al leer el catálogo (cada uno elige su fuente)
const cart = createCart();
let flip; // PageFlip (escritorio) o MobilePager (celular): misma interfaz
let bookData = null;
let loader = null; // carga progresiva de páginas (ver createPageLoader)
const loadFont = (href) => document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));

// Marca que se muestra en el encabezado según la fuente de productos del catálogo
const brands = {
  directus: { name: 'Just', logo: '/brand/just-logo.svg' },
  arbell: { name: 'Arbell', logo: '/brand/arbell-logo.png', small: true },
};

// En celular, una página por vez sin efecto de hoja
const mobileQuery = window.matchMedia('(max-width: 800px)');

init();

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const fail = (msg) => ($('#book-wrap').innerHTML = `<div class="loading"><p>${esc(msg)}</p></div>`);
  if (!id) return fail('Falta indicar qué catálogo abrir.');
  let catalog;
  try {
    catalog = await getPublicCatalogInfo(id);
  } catch (err) {
    return fail(`No se pudo cargar el catálogo: ${err.message}`);
  }
  if (!catalog) return fail('Este catálogo no existe o fue eliminado.');
  // El link al editor solo aparece para quien administra (se marca al entrar a /admin en este navegador)
  if (isAdminBrowser()) {
    $('#editor-link').href = `/admin/editor.html?id=${encodeURIComponent(id)}`;
    $('#editor-link').hidden = false;
  }
  products = createProductSource(catalog.source);
  const brand = brands[catalog.source] ?? brands.directus;
  $('.brand-logo img').src = brand.logo;
  $('.brand-logo img').alt = brand.name;
  $('.brand-logo').classList.toggle('brand-logo-small', Boolean(brand.small));
  document.body.dataset.brand = catalog.source ?? 'directus'; // activa el tema de la marca (ver "Tema Arbell" en styles.css)
  if (catalog.source === 'arbell') loadFont('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
  const title = catalogTitle(catalog);
  $('#title').textContent = title;
  document.title = `${title} · ${brand.name}`;

  const progress = progressView('Abriendo catálogo…');
  $('#book-wrap').replaceChildren(progress.node);
  let doc;
  try {
    ({ doc } = await openPdf(publicPdfUrl(id)));
  } catch (err) {
    return fail(`No se pudo abrir el PDF: ${err.message}`);
  }

  // Todas las páginas arrancan vacías (con la proporción de la primera) y se renderizan de a tandas
  const { width, height } = await pageRatio(doc, 1);
  const pages = Array.from({ length: doc.numPages }, (_, i) => ({ n: i + 1, url: null, width, height }));
  loader = createPageLoader(doc, pages);
  const total = pages.length;
  const startIndex = Math.min(Math.max(Number(new URLSearchParams(location.search).get('page')) || 1, 1), total) - 1;
  // Mostrar el libro recién cuando la página de inicio está lista: nunca una pantalla en blanco
  await loader.ensure(visiblePagesFor(startIndex + 1, total), { wait: true });

  buildBook(pages, catalog.hotspots, startIndex);
  // El índice viene armado desde el editor. Si todavía no está (catálogo sin abrir en el editor), se arma del PDF,
  // pero recién cuando ya cargaron las primeras páginas: recorrerlo baja un trozo del archivo por cada página.
  if (Array.isArray(catalog.outline)) setupToc(catalog.outline);
  else
    setTimeout(
      () =>
        outlineOf(doc)
          .then(setupToc)
          .catch(() => {}), // sin marcadores: el botón de contenido queda oculto
      8000,
    );
  refreshCart();
  bindUi();
}

function isAdminBrowser() {
  try {
    return localStorage.getItem('flipbook-admin') === '1';
  } catch {
    return false;
  }
}

function buildBook(pages, hotspots, start = null) {
  bookData = { pages, hotspots };
  const last = pages.length;
  const startIndex = start ?? Math.min(Math.max(Number(new URLSearchParams(location.search).get('page')) || 1, 1), last) - 1;
  const mobile = mobileQuery.matches;
  const book = el(`<div id="book"${mobile ? ' class="mobile-book"' : ''}></div>`);
  for (const p of pages) book.append(pageElement(p, hotspots, last));
  flip?.destroy?.();
  $('#book-wrap').replaceChildren(book);

  if (mobile) {
    flip = new MobilePager(book, { start: startIndex });
    bindMobileZoom(book);
  } else {
    const { width, height } = pages[0];
    const baseH = 800;
    flip = new PageFlip(book, {
      width: Math.round((width / height) * baseH),
      height: baseH,
      size: 'stretch',
      minWidth: 280,
      maxWidth: 1000,
      minHeight: 400,
      maxHeight: 1400,
      showCover: true,
      usePortrait: true,
      maxShadowOpacity: 0.4,
      mobileScrollSupport: false,
      // Como iPaper: la página no se pasa con clic ni arrastrando (el clic es para ampliar);
      // se pasa con las flechas de los costados, las del encabezado o el teclado
      useMouseEvents: false,
      disableFlipByClick: true,
    });
    flip.loadFromHTML(book.querySelectorAll('.page'));
    shrinkCornerPreview(flip);
    if (startIndex > 0) flip.turnToPage(startIndex);
  }

  updateIndicator();
  flip.on('flip', updateIndicator);
  flip.on('changeOrientation', () => {
    updateIndicator();
    placeEdgeButtons();
  });
  placeEdgeButtons();
}

// Al cruzar el ancho de celular (girar el teléfono, achicar la ventana) se cambia de modo sin perder la página
mobileQuery.addEventListener('change', () => {
  if (bookData) buildBook(bookData.pages, bookData.hotspots, flip.getCurrentPageIndex());
});
window.addEventListener('resize', () => requestAnimationFrame(placeEdgeButtons));

function pageElement(p, hotspots, last) {
  const hard = p.n === 1 || p.n === last ? ' data-density="hard"' : '';
  const page = el(
    `<div class="page${p.url ? '' : ' pending'}"${hard} data-page="${p.n}"><div class="page-inner" style="--ratio:${p.width / p.height}"><div class="zoom-layer"><img ${p.url ? `src="${p.url}"` : ''} alt="Página ${p.n}" draggable="false"></div></div></div>`,
  );
  const layer = page.querySelector('.zoom-layer');
  for (const h of hotspots.filter((x) => x.page === p.n && x.type === 'link')) {
    const style = `left:${h.x * 100}%;top:${h.y * 100}%;width:${h.w * 100}%;height:${h.h * 100}%`;
    let area;
    if (linkKind(h) === 'url') {
      const href = normalizeUrl(h.url);
      if (!href) continue;
      // Web externa: enlace real en pestaña nueva (el catálogo queda abierto)
      area = el(`<a class="link-area" style="${style}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${esc(urlHost(href))} en una pestaña nueva"></a>`);
    } else {
      if (!(h.target >= 1 && h.target <= last)) continue;
      area = el(`<button class="link-area" style="${style}" aria-label="Ir a la página ${h.target}"></button>`);
      area.addEventListener('click', (e) => {
        e.stopPropagation();
        goTo(h.target);
      });
    }
    for (const ev of ['mousedown', 'touchstart', 'pointerdown']) area.addEventListener(ev, (e) => e.stopPropagation());
    layer.append(area);
  }
  for (const h of hotspots.filter((x) => x.page === p.n && x.type !== 'link' && x.code)) {
    const btn = el(
      `<button class="hotspot${h.sale ? ' sale' : ''}" style="left:${h.x * 100}%;top:${h.y * 100}%" aria-label="${h.sale ? 'Ver oferta' : 'Ver producto'} ${esc(h.code)}">${icon(h.sale ? 'percent' : 'plus')}</button>`,
    );
    // Evita que el toque sobre el "+" arranque un giro de página
    for (const ev of ['mousedown', 'touchstart', 'pointerdown']) btn.addEventListener(ev, (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProduct(h.code, { sale: h.sale });
    });
    layer.append(btn);
  }
  return page;
}

// ---------- Carga progresiva de páginas ----------
// Se renderizan de a BATCH páginas: primero desde donde abre el catálogo; cuando el lector llega a la anteúltima
// página cargada, se piden las BATCH siguientes. Si salta a una página sin cargar (índice, "ir a página", enlaces),
// esa página y las siguientes pasan adelante en la cola.
const BATCH = 5;

function visiblePagesFor(i, total, orientation = mobileQuery.matches ? 'portrait' : 'landscape') {
  // En doble página: la 1 va sola (tapa) y después pares 2–3, 4–5…
  if (orientation === 'portrait' || i === 1 || i >= total) return [i];
  const left = i % 2 === 0 ? i : i - 1;
  return left + 1 <= total ? [left, left + 1] : [left];
}

function createPageLoader(doc, pages) {
  const total = pages.length;
  const queue = [];
  const queued = new Set();
  const waiters = new Map(); // n → [resolve]
  let running = false;

  const loaded = (n) => Boolean(pages[n - 1]?.url);

  function enqueue(list, { front = false } = {}) {
    const todo = list.filter((n) => n >= 1 && n <= total && !loaded(n));
    for (const n of todo) {
      if (front) {
        // Los pedidos urgentes pasan adelante (si ya estaban en la cola, se mueven)
        const k = queue.indexOf(n);
        if (k !== -1) queue.splice(k, 1);
      } else if (queued.has(n)) continue;
      queued.add(n);
      if (!front) queue.push(n);
    }
    if (front) queue.unshift(...todo);
    pump();
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const n = queue.shift();
      if (loaded(n)) continue;
      try {
        const r = await renderPage(doc, n);
        Object.assign(pages[n - 1], r);
        document.querySelectorAll(`.page[data-page="${n}"]`).forEach((page) => {
          page.querySelector('img').src = r.url;
          page.classList.remove('pending');
        });
      } catch (err) {
        console.warn(`No se pudo renderizar la página ${n}`, err);
      } finally {
        queued.delete(n);
        for (const resolve of waiters.get(n) ?? []) resolve();
        waiters.delete(n);
      }
    }
    running = false;
  }

  // Tanda que empieza en la primera página visible
  function ensure(visible, { wait = false } = {}) {
    const from = Math.min(...visible);
    enqueue(visible, { front: true });
    enqueue(range(from, from + BATCH - 1));
    if (!wait) return Promise.resolve();
    return Promise.all(visible.map((n) => (loaded(n) ? null : new Promise((r) => waiters.set(n, [...(waiters.get(n) ?? []), r])))));
  }

  // Cada vez que cambia la página: lo visible primero; si estamos en la anteúltima cargada, la tanda siguiente
  function onView(visible) {
    if (visible.some((n) => !loaded(n))) return ensure(visible);
    let end = Math.max(...visible);
    while (end < total && (loaded(end + 1) || queued.has(end + 1))) end++;
    if (Math.max(...visible) >= end - 1 && end < total) enqueue(range(end + 1, end + BATCH));
  }

  return { ensure, onView, loaded };
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// page-flip dobla la esquina al pasar el mouse dentro de una zona fija del 20% de la diagonal de la página
// (sin opción para cambiarla), y el doblez sigue al mouse por toda esa zona: tapa los hotspots.
// La achicamos a una esquina chica. Solo afecta la vista previa; arrastrar para pasar la hoja sigue igual.
const CORNER_RATIO = 0.06;
const CORNER_MIN = 36;
const CORNER_MAX = 56;

function shrinkCornerPreview(pageFlip) {
  const controller = pageFlip.getFlipController?.();
  if (!controller?.isPointOnCorners) return;
  controller.isPointOnCorners = function (pos) {
    const rect = this.getBoundsRect();
    const size = Math.min(CORNER_MAX, Math.max(CORNER_MIN, Math.hypot(rect.pageWidth, rect.height) * CORNER_RATIO));
    const p = this.render.convertToBook(pos);
    return p.x > 0 && p.y > 0 && p.x < rect.width && p.y < rect.height && (p.x < size || p.x > rect.width - size) && (p.y < size || p.y > rect.height - size);
  };
}

// Alinea los botones de inicio/final con el borde superior de las páginas
function placeEdgeButtons() {
  const column = document.querySelector('.side-nav').getBoundingClientRect();
  const book = $('#book')?.getBoundingClientRect();
  if (!book) return;
  if (!book.height || !column.height) return;
  document.documentElement.style.setProperty('--book-top', `${Math.round(book.top - column.top)}px`);
}

function updateIndicator() {
  const total = flip.getPageCount();
  const i = flip.getCurrentPageIndex() + 1;
  loader?.onView(visiblePagesFor(i, total, flip.getOrientation()));
  mobileZoomOut();
  const spread = flip.getOrientation() === 'landscape' && i > 1 && i < total;
  const atEnd = i >= total || (spread && i + 1 >= total);
  $('#first').disabled = $('#prev').disabled = i <= 1;
  $('#last').disabled = $('#next').disabled = atEnd;
  $('#page-indicator').textContent = spread ? `${i}–${i + 1} / ${total}` : `${i} / ${total}`;
  const url = new URL(location.href);
  url.searchParams.set('page', i);
  history.replaceState(null, '', url);
}

// ---------- Ficha de producto ----------
let closeCurrentProduct = null; // nunca más de una ficha abierta a la vez

async function openProduct(code, { sale = false } = {}) {
  closeCurrentProduct?.();
  const overlay = el(`<div class="overlay" role="dialog" aria-modal="true" aria-label="Producto">
    <div class="modal loading-state"><button class="modal-close" aria-label="Cerrar">${icon('close')}</button>
      <div class="loading">Cargando producto…</div></div></div>`);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (closeCurrentProduct === close) closeCurrentProduct = null;
  };
  closeCurrentProduct = close;
  const onKey = (e) => e.key === 'Escape' && close();
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  overlay.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);

  const fail = (html) => {
    overlay.querySelector('.loading').outerHTML = `<p class="notice">${icon('alert')}<span>${html}</span></p>`;
  };
  try {
    const product = await products.getByCode(code);
    if (!product) return fail(`El código <b>${esc(code)}</b> no existe en el CMS.`);
    renderProduct(overlay, { ...product, sale }, close);
  } catch (err) {
    fail(`No se pudo cargar el producto: ${esc(err.message)}`);
  }
}

// ---------- Pestañas de detalle: beneficios, modos de uso, sugerencias ----------
function detailTabs(p) {
  const tabs = [];
  if (p.benefits?.length)
    tabs.push({
      id: 'benefits',
      label: 'Beneficios',
      html: `<ul class="benefits">${p.benefits
        .map((b) => `<li>${icon('check')}<span><b>${esc(b.benefit)}</b>${b.benefit && b.description ? '. ' : ''}${esc(b.description)}</span></li>`)
        .join('')}</ul>`,
    });
  if (p.usageModes?.length)
    tabs.push({
      id: 'usage',
      label: 'Modos de uso',
      html: `<ul class="usage-modes">${p.usageModes
        .map(
          (u) => `<li>
            ${u.image ? `<img src="${esc(u.image)}" alt="" loading="lazy">` : `<span class="usage-icon">${icon('check')}</span>`}
            <div>${u.title ? `<b>${esc(u.title)}</b>` : ''}${u.text ? `<p>${esc(u.text)}</p>` : ''}</div>
          </li>`,
        )
        .join('')}</ul>`,
    });
  if (p.suggestions?.length)
    tabs.push({
      id: 'suggestions',
      label: 'Sugerencias de uso',
      html: `<ul class="suggestions">${p.suggestions.map((t) => `<li>${icon('right')}<span>${esc(t)}</span></li>`).join('')}</ul>`,
    });
  return tabs;
}

function tabsHtml(tabs) {
  if (!tabs.length) return '';
  return `<div class="detail-tabs">
    <div class="tab-list" role="tablist">${tabs
      .map((t, i) => `<button role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t.label}</button>`)
      .join('')}</div>
    ${tabs
      .map((t, i) => `<div class="tab-panel" role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}"${i === 0 ? '' : ' hidden'}>${t.html}</div>`)
      .join('')}
  </div>`;
}

function bindTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      root.querySelector(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    // Flechas del teclado entre pestañas
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
}

// Precio anterior tachado (solo si es mayor que el actual)
const oldPriceHtml = (price, oldPrice) =>
  oldPrice != null && price != null && oldPrice > price ? ` <s class="price-old">${formatMoney(oldPrice, { decimals: false })}</s>` : '';

// ---------- Productos relacionados (Directus: related_products) ----------
function relatedSection(related = []) {
  if (!related.length) return '';
  return `<section class="related" aria-label="Productos relacionados">
    <div class="related-head">
      <p class="section-title">Productos relacionados</p>
      <div class="related-nav">
        <button class="icon-btn sm" data-scroll="-1" aria-label="Anteriores">${icon('left')}</button>
        <button class="icon-btn sm" data-scroll="1" aria-label="Siguientes">${icon('right')}</button>
      </div>
    </div>
    <div class="related-track" tabindex="0">
      ${related
        .map(
          // Estructura de la "Product Card" del design system: foto / título / precio + presentación
          (r) => `<button class="rel-card" data-key="${esc(r.key)}" aria-label="${esc(r.name)}">
            <span class="rel-photo">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}</span>
            <span class="rel-title">${esc(r.name)}</span>
            <span class="rel-bottom">
              <span class="rel-price">${r.price != null ? `${r.multiplePrices ? '<small>desde</small> ' : ''}${formatMoney(r.price, { decimals: false })}${oldPriceHtml(r.price, r.oldPrice)}` : '<small>Sin precio</small>'}</span>
              ${r.size && r.size !== 'Única' ? `<span class="rel-size">${esc(r.size)}</span>` : ''}
            </span>
          </button>`,
        )
        .join('')}
    </div>
  </section>`;
}

function bindRelated(modal, overlay, close) {
  const track = modal.querySelector('.related-track');
  if (!track) return;
  const nav = modal.querySelectorAll('[data-scroll]');
  const syncNav = () => {
    const max = track.scrollWidth - track.clientWidth;
    modal.querySelector('.related-nav').hidden = max <= 4;
    nav[0].disabled = track.scrollLeft <= 4;
    nav[1].disabled = track.scrollLeft >= max - 4;
  };
  nav.forEach((b) =>
    b.addEventListener('click', () => track.scrollBy({ left: Number(b.dataset.scroll) * track.clientWidth * 0.8, behavior: 'smooth' })),
  );
  track.addEventListener('scroll', syncNav, { passive: true });
  requestAnimationFrame(syncNav);

  // Tocar un relacionado muestra su ficha en el mismo modal
  modal.querySelectorAll('.rel-card').forEach((card) =>
    card.addEventListener('click', async () => {
      card.classList.add('loading-card');
      try {
        const next = await products.getByCode(card.dataset.key);
        if (!next) throw new Error('no está en el CMS');
        renderProduct(overlay, { ...next, sale: false }, close);
      } catch (err) {
        card.classList.remove('loading-card');
        toast(`No se pudo abrir el producto: ${err.message}`, { error: true });
      }
    }),
  );
}

function renderProduct(overlay, product, close) {
  const { variants, images } = product;
  // En Arbell la descripción va debajo, a todo el ancho del modal, y no dentro del scroll de la columna de información
  const wideDescription = document.body.dataset.brand === 'arbell';
  const buyable = variants.some((v) => cart.canBuy(v));
  let selected = Math.max(0, variants.findIndex((v) => v.code === product.selectedCode));
  let qty = 1;

  const modal = overlay.querySelector('.modal');
  modal.classList.remove('loading-state');
  modal.innerHTML = `
    <button class="modal-close" aria-label="Cerrar">${icon('close')}</button>
    <div class="product">
      <div class="product-media">
        <div class="main">${images[0] ? `<img id="main-img" src="${esc(images[0])}" alt="${esc(product.name)}">` : ''}</div>
        ${
          images.length > 1
            ? `<div class="thumbs-row">${images
                .map((src, i) => `<button data-img="${i}" aria-current="${i === 0}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`)
                .join('')}</div>`
            : ''
        }
      </div>
      <div class="product-info">
        <!-- Encabezado como el detalle de producto del ecommerce: tags · bajada en mayúsculas · nombre · código · precio -->
        <div class="pd-head">
          ${product.sale || variants.some((x) => x.oldPrice > x.price) ? `<div class="pd-tags"><span class="sale-badge">Oferta</span></div>` : ''}
          ${product.tagline ? `<p class="pd-overline">${esc(product.tagline)}</p>` : ''}
          <h2>${esc(product.name)}</h2>
          <p class="pd-code" id="code-line"></p>
          ${buyable ? '<div class="price" id="price"></div>' : ''}
        </div>
        ${
          buyable || variants.length > 1
            ? `<div class="pd-options">
                ${
                  variants.length > 1
                    ? `<div class="pd-field pd-variants"><span class="pd-label">Presentación</span><div class="chips" role="group" aria-label="Presentación">${variants
                        .map((v, i) => `<button class="chip" data-variant="${i}" aria-pressed="${i === selected}">${esc(v.label)}</button>`)
                        .join('')}</div></div>`
                    : ''
                }
                ${
                  buyable
                    ? `<div class="pd-field pd-qty"><span class="pd-label">Cantidad</span>
                        <div class="stepper" aria-label="Cantidad">
                          <button data-qty="-1" aria-label="Quitar uno">${icon('minus')}</button>
                          <output id="qty">1</output>
                          <button data-qty="1" aria-label="Agregar uno">${icon('plus')}</button>
                        </div></div>`
                    : ''
                }
              </div>`
            : ''
        }
        ${
          buyable
            ? '<button class="btn pd-add" id="add">Agregar al carrito</button>'
            : `<p class="notice">${icon('alert')}<span>Este producto todavía no está disponible para comprar desde el catálogo.</span></p>`
        }
        ${(!wideDescription && product.description) || detailTabs(product).length ? '<div class="divider"></div>' : ''}
        ${!wideDescription && product.description ? `<p class="desc">${esc(product.description)}</p>` : ''}
        ${tabsHtml(detailTabs(product))}
      </div>
    </div>
    ${wideDescription && product.description ? `<section class="pd-description"><p class="desc">${esc(product.description)}</p></section>` : ''}
    ${relatedSection(product.related)}`;
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.scrollTop = 0;
  // Arbell en celular: cantidad + "Agregar al carrito" quedan fijos abajo, como un bottom sheet.
  // Se mueven los mismos nodos (con sus eventos) a una barra pegada al borde inferior del modal.
  if (wideDescription && buyable && window.matchMedia('(max-width: 860px)').matches) {
    const sheet = document.createElement('div');
    sheet.className = 'pd-sheet';
    sheet.append(modal.querySelector('.pd-qty'), modal.querySelector('#add'));
    modal.append(sheet);
  }
  bindRelated(modal, overlay, close);

  bindTabs(modal);

  modal.querySelectorAll('[data-img]').forEach((b) =>
    b.addEventListener('click', () => {
      modal.querySelector('#main-img').src = images[b.dataset.img];
      modal.querySelectorAll('[data-img]').forEach((x) => x.setAttribute('aria-current', x === b));
    }),
  );

  const addBtn = modal.querySelector('#add');
  const sync = () => {
    const v = variants[selected];
    modal.querySelector('#code-line').textContent = v?.code ? `Código ${v.code}` : '';
    modal.querySelectorAll('[data-variant]').forEach((c) => c.setAttribute('aria-pressed', Number(c.dataset.variant) === selected));
    if (!addBtn) return;
    const ok = v && cart.canBuy(v);
    modal.querySelector('#price').innerHTML = ok ? `${formatMoney(v.price, { decimals: false })}${oldPriceHtml(v.price, v.oldPrice)}` : 'Sin precio para esta presentación';
    addBtn.disabled = !ok;
    modal.querySelector('#qty').textContent = qty;
    modal.querySelector('[data-qty="-1"]').disabled = qty <= 1;
  };
  modal.querySelectorAll('[data-variant]').forEach((c) =>
    c.addEventListener('click', () => {
      selected = Number(c.dataset.variant);
      sync();
    }),
  );
  modal.querySelectorAll('[data-qty]').forEach((b) =>
    b.addEventListener('click', () => {
      qty = Math.max(1, Math.min(99, qty + Number(b.dataset.qty)));
      sync();
    }),
  );
  sync();
  if (!addBtn) return;

  addBtn.addEventListener('click', async () => {
    const v = variants[selected];
    addBtn.disabled = true;
    try {
      renderCart(await cart.add({ ...product, image: images[0] }, v, qty));
      close();
      toast(`${product.name} · ${v.label} ×${qty} agregado`);
      const badge = $('#cart-count');
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
    } catch (err) {
      toast(`No se pudo agregar: ${err.message}`, { error: true });
      addBtn.disabled = false;
    }
  });
}

// ---------- Carrito ----------
async function refreshCart() {
  renderCart(await cart.get());
}

function renderCart(data) {
  $('#cart-count').textContent = data.item_count;
  $('#cart-count-label').textContent = data.item_count ? `(${data.item_count})` : '';
  $('#cart-total').textContent = formatMoney(data.total_price);
  $('#checkout').disabled = data.item_count === 0;
  const lines = $('#cart-lines');
  if (!data.items.length) {
    lines.innerHTML = `<div class="empty-cart">${icon('bag')}<p>Todavía no agregaste productos.<br>Tocá el <b>+</b> sobre un producto del catálogo.</p></div>`;
    return;
  }
  lines.replaceChildren(
    ...data.items.map((l) => {
      const row = el(`<div class="line">
        ${l.image ? `<img class="thumb-img" src="${esc(l.image)}" alt="">` : '<div class="thumb-img"></div>'}
        <div>
          <div class="name">${esc(l.product_title)}</div>
          <div class="sub">${esc(l.variant_title ?? '')} · ${formatMoney(l.price)}</div>
          <div class="stepper sm">
            <button data-d="-1" aria-label="Quitar uno">${icon(l.quantity === 1 ? 'trash' : 'minus')}</button>
            <output>${l.quantity}</output>
            <button data-d="1" aria-label="Agregar uno">${icon('plus')}</button>
          </div>
        </div>
        <div class="amount">${formatMoney(l.line_price)}</div>
      </div>`);
      row.querySelectorAll('[data-d]').forEach((b) =>
        b.addEventListener('click', async () => {
          renderCart(await cart.change(l.key, l.quantity + Number(b.dataset.d)));
        }),
      );
      return row;
    }),
  );
}

// ---------- Zoom (escritorio) ----------
// Clic sobre la página: amplía el libro dentro de su espacio (el resto de la interfaz no cambia).
// Ampliado, mover el mouse recorre la página; otro clic, Esc o pasar de página lo vuelve al tamaño normal.
const ZOOM = 2.2;

function bindZoom() {
  const wrap = $('#book-wrap');
  wrap.addEventListener('click', (e) => {
    const book = $('#book');
    if (!book || mobileQuery.matches || book.classList.contains('mobile-book')) return;
    if (wrap.classList.contains('zoomed')) return zoomOut();
    if (!e.target.closest('.page')) return; // clic fuera de las páginas
    zoomIn(e);
  });
  wrap.addEventListener('mousemove', (e) => wrap.classList.contains('zoomed') && panTo(e));
  mobileQuery.addEventListener('change', zoomOut);
}

// Posición del puntero como fracción del libro (sin la transformación del zoom)
function pointerFraction(e) {
  const wrap = $('#book-wrap');
  const book = $('#book');
  const w = wrap.getBoundingClientRect();
  const left = w.left + book.offsetLeft;
  const top = w.top + book.offsetTop;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  return { fx: clamp01((e.clientX - left) / book.offsetWidth), fy: clamp01((e.clientY - top) / book.offsetHeight) };
}

function panTo(e) {
  const book = $('#book');
  const { fx, fy } = pointerFraction(e);
  // El punto del libro bajo el origen queda fijo: llevar el origen con el puntero recorre toda la página
  book.style.transformOrigin = `${fx * book.offsetWidth}px ${fy * book.offsetHeight}px`;
}

function zoomIn(e) {
  const wrap = $('#book-wrap');
  panTo(e);
  wrap.classList.add('zoomed');
  $('#book').style.transform = `scale(${ZOOM})`;
}

function zoomOut() {
  mobileZoomOut();
  const wrap = $('#book-wrap');
  if (!wrap.classList.contains('zoomed')) return;
  wrap.classList.remove('zoomed');
  const book = $('#book');
  if (book) book.style.transform = '';
}

// ---------- Zoom en celular: doble toque ----------
// Doble toque sobre la página: se amplía en ese punto. Ampliada, se recorre arrastrando con el dedo y no se pasa
// de página al deslizar. Otro doble toque, Esc o cambiar de página la vuelve al tamaño normal.
const MOBILE_ZOOM = 2.2;
let mz = null; // { book, inner, layer, tx, ty }

function bindMobileZoom(book) {
  let lastTap = { t: 0, x: 0, y: 0 };
  let drag = null;

  book.addEventListener('pointerdown', (e) => {
    if (!mz || e.target.closest('.hotspot, .link-area') || !e.target.closest('.page-inner.zoomed')) return;
    drag = { x: e.clientX, y: e.clientY, tx: mz.tx, ty: mz.ty, moved: false };
    mz.layer.classList.add('dragging');
    try {
      mz.inner.setPointerCapture(e.pointerId);
    } catch {}
  });
  book.addEventListener('pointermove', (e) => {
    if (!drag || !mz) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    setPan(drag.tx + dx, drag.ty + dy);
  });
  const endDrag = () => {
    mz?.layer.classList.remove('dragging');
    const moved = drag?.moved;
    drag = null;
    return moved;
  };
  book.addEventListener('pointercancel', endDrag);
  book.addEventListener('pointerup', (e) => {
    if (endDrag()) return; // fue un arrastre, no un toque
    const inner = e.target.closest('.page-inner');
    if (!inner || e.target.closest('.hotspot, .link-area')) return;
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap.t = 0;
      if (mz) mobileZoomOut();
      else mobileZoomIn(book, inner, e);
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  });
}

function mobileZoomIn(book, inner, e) {
  const layer = inner.querySelector('.zoom-layer');
  const r = inner.getBoundingClientRect();
  mz = { book, inner, layer, tx: 0, ty: 0 };
  // El punto tocado queda bajo el dedo
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  book.classList.add('zoomed');
  inner.classList.add('zoomed');
  setPan(px - px * MOBILE_ZOOM, py - py * MOBILE_ZOOM);
}

function setPan(tx, ty) {
  const { inner, layer } = mz;
  const w = inner.clientWidth;
  const h = inner.clientHeight;
  // Sin dejar ver fuera de la página
  mz.tx = Math.min(0, Math.max(w - w * MOBILE_ZOOM, tx));
  mz.ty = Math.min(0, Math.max(h - h * MOBILE_ZOOM, ty));
  layer.style.transform = `translate(${mz.tx}px, ${mz.ty}px) scale(${MOBILE_ZOOM})`;
}

function mobileZoomOut() {
  if (!mz) return;
  mz.layer.style.transform = '';
  mz.inner.classList.remove('zoomed');
  mz.book.classList.remove('zoomed');
  mz = null;
}

// ---------- Ir a página ----------
function goTo(pageNumber) {
  zoomOut();
  const target = Math.min(Math.max(pageNumber, 1), flip.getPageCount()) - 1;
  if (target !== flip.getCurrentPageIndex()) flip.flip(target);
}

function bindPageJump() {
  const btn = $('#page-indicator');
  const form = $('#page-jump-form');
  const input = $('#page-jump-input');
  const close = () => {
    form.hidden = true;
    btn.hidden = false;
  };
  btn.addEventListener('click', () => {
    const total = flip.getPageCount();
    input.max = total;
    input.value = flip.getCurrentPageIndex() + 1;
    $('#page-jump-total').textContent = `/ ${total}`;
    btn.hidden = true;
    form.hidden = false;
    input.focus();
    input.select();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const total = flip.getPageCount();
    const n = parseInt(input.value, 10);
    close();
    if (!Number.isFinite(n)) return;
    goTo(n);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      btn.focus();
    }
  });
  input.addEventListener('blur', close);
}

// ---------- Tabla de contenidos (marcadores del PDF) ----------
// Igual que iPaper: panel lateral; las secciones con subsecciones se abren en el mismo panel con "volver".
// A diferencia de iPaper, la sección padre también es navegable ("Ver sección completa").
const toc = { tree: [], path: [] };

function setupToc(tree) {
  toc.tree = tree;
  if (!tree.length) return;
  $('#toc-btn').hidden = false;
  $('#toc-btn').addEventListener('click', () => setToc(!$('#toc').classList.contains('open')));
  $('#toc-close').addEventListener('click', () => setToc(false));
  $('#toc-back').addEventListener('click', () => {
    toc.path.pop();
    renderToc();
  });
}

function setToc(open) {
  if (open) {
    setDrawer(false);
    // Abrir directamente en la sección donde está el lector
    toc.path = currentTrail(toc.tree).slice(0, -1);
    renderToc();
  }
  $('#toc').classList.toggle('open', open);
  $('#toc').setAttribute('aria-hidden', String(!open));
  $('#toc-btn').setAttribute('aria-expanded', String(open));
  $('#scrim').classList.toggle('open', open || $('#drawer').classList.contains('open'));
}

// Cadena de nodos (de la raíz a la hoja) de la sección que contiene la página actual
function currentTrail(nodes, page = flip.getCurrentPageIndex() + 1) {
  let best = null;
  for (const n of nodes) if (n.page && n.page <= page && (!best || n.page >= best.page)) best = n;
  if (!best) return [];
  return [best, ...currentTrail(best.children, page)];
}

function renderToc() {
  const parent = toc.path.at(-1);
  const nodes = parent ? parent.children : toc.tree;
  const trail = currentTrail(toc.tree);
  $('#toc-title').textContent = parent ? parent.title : 'Contenido';
  $('#toc-back').hidden = !parent;

  const rows = [];
  if (parent?.page) {
    const b = el(`<button class="toc-item overview"><span class="toc-title">Ver sección completa</span><span class="toc-page">p. ${parent.page}</span><span></span></button>`);
    b.addEventListener('click', () => pick(parent.page));
    rows.push(b);
  }
  for (const n of nodes) {
    const hasKids = n.children.length > 0;
    const b = el(`<button class="toc-item" aria-current="${trail.includes(n)}">
        <span class="toc-title">${esc(n.title)}</span>
        <span class="toc-page">${n.page ? `p. ${n.page}` : ''}</span>
        ${hasKids ? icon('right') : '<span></span>'}
      </button>`);
    b.addEventListener('click', () => {
      if (hasKids) {
        toc.path.push(n);
        renderToc();
      } else if (n.page) pick(n.page);
    });
    rows.push(b);
  }
  $('#toc-list').replaceChildren(...rows);
  $('#toc-list').scrollTop = 0;
}

function pick(page) {
  goTo(page);
  setToc(false);
}

function setDrawer(open) {
  $('#drawer').classList.toggle('open', open);
  $('#drawer').setAttribute('aria-hidden', String(!open));
  if (open && $('#toc').classList.contains('open')) setToc(false);
  $('#scrim').classList.toggle('open', open);
}

function bindUi() {
  const prev = () => (zoomOut(), flip.flipPrev());
  const next = () => (zoomOut(), flip.flipNext());
  for (const id of ['#prev', '#prev-top']) $(id).addEventListener('click', prev);
  for (const id of ['#next', '#next-top']) $(id).addEventListener('click', next);
  bindZoom();
  $('#first').addEventListener('click', () => goTo(1));
  $('#last').addEventListener('click', () => goTo(flip.getPageCount()));
  bindPageJump();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setDrawer(false);
      setToc(false);
      zoomOut();
    }
    if (document.querySelector('.overlay') || e.target.matches?.('input')) return;
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'Home') goTo(1);
    if (e.key === 'End') goTo(flip.getPageCount());
  });
  $('#cart-btn').addEventListener('click', () => setDrawer(true));
  $('#drawer-close').addEventListener('click', () => setDrawer(false));
  $('#scrim').addEventListener('click', () => {
    setDrawer(false);
    setToc(false);
  });
  $('#checkout').addEventListener('click', () => cart.checkout());
}

// Íconos declarados en el HTML con data-icon
document.querySelectorAll('[data-icon]').forEach((n) => n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon)));
