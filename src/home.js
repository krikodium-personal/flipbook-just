// Página de inicio: listado de catálogos + creación desde un PDF.
import { renderCover } from './lib/pdf.js';
import { listCatalogs, getCatalog, createCatalog, deleteCatalog, patchMeta, fetchDemoCatalog, catalogTitle } from './lib/store.js';
import * as local from './lib/local-store.js';
import { $, esc, el, icon, toast, confirmDialog } from './lib/ui.js';

document.querySelectorAll('[data-icon]').forEach((n) => n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon)));
try {
  localStorage.setItem('flipbook-admin', '1'); // el visor muestra el link "Editor" en este navegador
} catch {}

$('#new-pdf').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) createFromFile(file);
});
$('#demo-btn').addEventListener('click', createDemo);

// Soltar un PDF en cualquier parte de la página crea un catálogo
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => e.relatedTarget === null && document.body.classList.remove('dropping'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (file) createFromFile(file);
});

render();

async function render() {
  const root = $('#home');
  let catalogs;
  try {
    catalogs = await listCatalogs();
  } catch (err) {
    root.replaceChildren(
      el(`<div class="banner error"><p><b>No se pudo cargar el listado.</b> ${esc(err.message)}</p>
        <button class="btn secondary sm" data-retry>Reintentar</button></div>`),
    );
    root.querySelector('[data-retry]').addEventListener('click', render);
    return;
  }
  const legacy = await localCatalogs();
  if (!catalogs.length && !legacy.length) {
    root.replaceChildren(
      el(`<div class="stage"><div class="drop">
        <div class="icon-circle">${icon('upload')}</div>
        <h2>Creá tu primer catálogo</h2>
        <p>Arrastrá el PDF acá o elegilo desde tu computadora. Si tiene la capa “Products ID”, los productos se marcan solos.</p>
        <div class="stack"><label class="btn" for="new-pdf">Elegir PDF</label>
        <button class="btn secondary" data-demo>Probar con el catálogo demo</button></div>
      </div></div>`),
    );
    root.querySelector('[data-demo]').addEventListener('click', createDemo);
    return;
  }

  const grid = el(`<section class="catalog-grid" aria-label="Catálogos"></section>`);
  if (!catalogs.length) grid.append(el('<p class="meta">Todavía no hay catálogos en Cloudflare.</p>'));
  for (const c of catalogs) grid.append(card(c));
  root.replaceChildren(
    ...legacyBanner(legacy),
    el(`<div class="home-head"><div><span class="eyebrow">${catalogs.length} ${catalogs.length === 1 ? 'catálogo' : 'catálogos'}</span>
      <h1>Tus catálogos</h1></div>
      <p class="hint">Soltá un PDF en cualquier parte de la página para crear uno nuevo.</p></div>`),
    grid,
  );
  // Portadas que faltan (catálogos migrados): se generan una vez y quedan guardadas
  for (const c of catalogs.filter((x) => !x.cover || !x.pages)) fillCover(c);
}

function card(c) {
  const id = encodeURIComponent(c.id);
  const stats = [
    c.pages ? `${c.pages} páginas` : null,
    `${c.products} ${c.products === 1 ? 'producto' : 'productos'}`,
    c.links ? `${c.links} ${c.links === 1 ? 'enlace' : 'enlaces'}` : null,
  ].filter(Boolean);
  const node = el(`<article class="catalog-card" data-id="${esc(c.id)}">
      <a class="cover" href="/catalogo.html?id=${id}" target="_blank" rel="noopener" aria-label="Ver ${esc(catalogTitle(c))}">
        ${c.cover ? `<img src="${c.cover}" alt="">` : '<span class="cover-placeholder"></span>'}
      </a>
      <div class="catalog-body">
        <h2>${esc(catalogTitle(c))}</h2>
        <p class="meta">${stats.join(' · ')}</p>
        <p class="meta" title="Creado el ${formatDate(c.createdAt)}">Actualizado ${relative(c.updatedAt)}</p>
        ${c.title ? `<p class="meta file" title="Archivo PDF">${icon('file')}${esc(c.name)}.pdf</p>` : ''}
      </div>
      <div class="catalog-actions">
        <a class="btn dark sm" href="/catalogo.html?id=${id}" target="_blank" rel="noopener">${icon('eye')}Ver</a>
        <a class="btn secondary sm" href="/admin/editor.html?id=${id}">${icon('edit')}Editar</a>
        <button class="icon-btn sm danger" data-delete aria-label="Eliminar ${esc(catalogTitle(c))}" title="Eliminar">${icon('trash')}</button>
      </div>
    </article>`);
  node.querySelector('[data-delete]').addEventListener('click', () => remove(c));
  return node;
}

async function createFromFile(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return toast('El archivo no es un PDF', { error: true });
  const busy = showBusy(`Creando “${file.name}”…`);
  try {
    const pdf = await file.arrayBuffer();
    const { cover, pages } = await renderCover(pdf);
    const catalog = await createCatalog({ name: file.name.replace(/\.pdf$/i, ''), pdf, cover, pages });
    // El editor lee los códigos de la capa "Products ID" al abrir
    location.href = `/admin/editor.html?id=${encodeURIComponent(catalog.id)}&detect`;
  } catch (err) {
    busy.remove();
    toast(`No se pudo leer el PDF: ${err.message}`, { error: true });
  }
}

async function createDemo() {
  const busy = showBusy('Creando catálogo demo…');
  try {
    const demo = await fetchDemoCatalog();
    const { cover, pages } = await renderCover(demo.pdf);
    const catalog = await createCatalog({ ...demo, cover, pages });
    location.href = `/admin/editor.html?id=${encodeURIComponent(catalog.id)}`;
  } catch (err) {
    busy.remove();
    toast(`No se pudo crear el demo: ${err.message}`, { error: true });
  }
}

async function remove(c) {
  const ok = await confirmDialog(`Se elimina “${catalogTitle(c)}” con su PDF y todos sus productos y enlaces. No se puede deshacer.`, {
    title: 'Eliminar catálogo',
    confirmLabel: 'Eliminar',
  });
  if (!ok) return;
  try {
    await deleteCatalog(c.id);
  } catch (err) {
    return toast(`No se pudo eliminar: ${err.message}`, { error: true });
  }
  toast(`“${catalogTitle(c)}” eliminado`);
  render();
}

async function fillCover(meta) {
  try {
    const full = await getCatalog(meta.id);
    if (!full) return;
    const { cover, pages } = await renderCover(full.pdf);
    await patchMeta(meta.id, { cover, pages });
    document.querySelector(`.catalog-card[data-id="${CSS.escape(meta.id)}"]`)?.replaceWith(card({ ...meta, cover, pages }));
  } catch {}
}

function showBusy(label) {
  const node = el(`<div class="overlay"><div class="modal dialog"><div class="loading"><img class="loading-logo" src="/brand/just-logo.svg" alt="">${esc(label)}</div></div></div>`);
  document.body.append(node);
  return node;
}

const formatDate = (t) => new Date(t).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

function relative(t) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  return `el ${formatDate(t)}`;
}

// ---------- Catálogos que quedaron en este navegador (versiones anteriores del prototipo) ----------
// La copia del navegador nunca se borra: los ya subidos se recuerdan en localStorage para no ofrecerlos de nuevo
const MIGRATED_KEY = 'flipbook-migrated';
const migratedIds = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(MIGRATED_KEY)) ?? []);
  } catch {
    return new Set();
  }
};
function markMigrated(id) {
  const ids = migratedIds();
  ids.add(id);
  try {
    localStorage.setItem(MIGRATED_KEY, JSON.stringify([...ids]));
  } catch {}
}

async function localCatalogs() {
  try {
    const done = migratedIds();
    return (await local.listCatalogs()).filter((c) => !done.has(c.id));
  } catch {
    return [];
  }
}

function legacyBanner(legacy) {
  if (!legacy.length) return [];
  const node = el(`<div class="banner">
      <p><b>${legacy.length === 1 ? 'Hay 1 catálogo guardado' : `Hay ${legacy.length} catálogos guardados`} solo en este navegador</b>
      (${legacy.map((c) => esc(catalogTitle(c))).join(', ')}). Subilos a Cloudflare para verlos online.</p>
      <button class="btn sm" data-migrate>${icon('upload')}Subir a Cloudflare</button>
    </div>`);
  node.querySelector('[data-migrate]').addEventListener('click', (e) => migrate(legacy, e.currentTarget));
  return [node];
}

async function migrate(legacy, btn) {
  btn.disabled = true;
  let done = 0;
  try {
    for (const meta of legacy) {
      btn.textContent = `Subiendo ${done + 1} de ${legacy.length}…`;
      const c = await local.getCatalog(meta.id);
      if (!c) continue;
      const cover = c.cover ?? meta.cover ?? null;
      const pages = c.pages ?? meta.pages ?? null;
      await createCatalog({ name: c.name, title: c.title ?? null, pdf: c.pdf, hotspots: c.hotspots, pages, cover });
      markMigrated(meta.id);
      done++;
    }
    toast(`${done} ${done === 1 ? 'catálogo subido' : 'catálogos subidos'} a Cloudflare`);
  } catch (err) {
    toast(`No se pudo subir: ${err.message}${done ? ` (se subieron ${done})` : ''}`, { error: true });
  }
  render();
}
