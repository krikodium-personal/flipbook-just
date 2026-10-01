export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Íconos de trazo (estilo Lucide), heredan color vía currentColor
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  area: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  first: '<path d="M6 6v12M17 18l-6-6 6-6"/>',
  last: '<path d="M18 6v12M7 18l6-6-6-6"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  bag: '<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};
export const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

let toastTimer;
export function toast(message, { error = false } = {}) {
  document.querySelector('.toast')?.remove();
  const node = el(`<div class="toast${error ? ' error' : ''}" role="status">${icon(error ? 'alert' : 'check')}<span>${esc(message)}</span></div>`);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2600);
}

export function progressView(label) {
  const node = el(`<div class="loading"><img class="loading-logo" src="/brand/just-logo.svg" alt="Just"><div>${esc(label)}</div><div class="progress"><div></div></div><small></small></div>`);
  return {
    node,
    update(n, total) {
      node.querySelector('.progress > div').style.width = `${(n / total) * 100}%`;
      node.querySelector('small').textContent = `${n} / ${total}`;
    },
  };
}

// Confirmación dentro de la página (window.confirm está bloqueado en algunos navegadores embebidos
// y devuelve false sin mostrar nada).
export function confirmDialog(message, { title = '¿Seguro?', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    const overlay = el(`<div class="overlay" role="alertdialog" aria-modal="true" aria-labelledby="cd-title">
      <div class="modal dialog">
        <h3 id="cd-title">${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="dialog-actions">
          <button class="btn secondary sm" data-r="0">${esc(cancelLabel)}</button>
          <button class="btn sm" data-r="1">${esc(confirmLabel)}</button>
        </div>
      </div></div>`);
    const done = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => e.key === 'Escape' && done(false);
    overlay.addEventListener('click', (e) => e.target === overlay && done(false));
    overlay.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => done(b.dataset.r === '1')));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    overlay.querySelector('[data-r="1"]').focus();
  });
}
