// Visor para celular: una página por pantalla, se pasa deslizando (scroll horizontal con snap), sin efecto de hoja.
// Expone la misma interfaz que usa el visor de PageFlip (flip, flipNext, flipPrev, turnToPage, getCurrentPageIndex,
// getPageCount, getOrientation, on('flip')), así el resto del visor funciona igual en los dos modos.
export class MobilePager {
  constructor(root, { start = 0 } = {}) {
    this.root = root;
    this.pages = [...root.children];
    this.index = clamp(start, 0, this.pages.length - 1);
    this.listeners = {};

    this.onScroll = () => {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.sync());
    };
    root.addEventListener('scroll', this.onScroll, { passive: true });
    // Al girar el teléfono o cambiar el tamaño, mantener la página actual
    this.resize = new ResizeObserver(() => this.jump(this.index));
    this.resize.observe(root);
    requestAnimationFrame(() => this.jump(this.index));
  }

  get width() {
    return this.root.clientWidth || 1;
  }

  sync() {
    const i = clamp(Math.round(this.root.scrollLeft / this.width), 0, this.pages.length - 1);
    if (i === this.index) return;
    this.index = i;
    this.emit('flip', { data: i });
  }

  jump(i) {
    this.root.scrollTo({ left: i * this.width, behavior: 'instant' });
  }

  flip(i) {
    const target = clamp(i, 0, this.pages.length - 1);
    // Saltos largos (índice, "ir a página", enlaces) van directo; de a una página, con desplazamiento suave
    const behavior = Math.abs(target - this.index) > 1 ? 'instant' : 'smooth';
    this.root.scrollTo({ left: target * this.width, behavior });
    if (behavior === 'instant') this.sync();
  }

  turnToPage(i) {
    this.index = clamp(i, 0, this.pages.length - 1);
    this.jump(this.index);
  }

  flipNext() {
    this.flip(this.index + 1);
  }

  flipPrev() {
    this.flip(this.index - 1);
  }

  getCurrentPageIndex() {
    return this.index;
  }

  getPageCount() {
    return this.pages.length;
  }

  getOrientation() {
    return 'portrait';
  }

  on(event, cb) {
    (this.listeners[event] ??= []).push(cb);
    return this;
  }

  emit(event, payload) {
    for (const cb of this.listeners[event] ?? []) cb(payload);
  }

  destroy() {
    this.resize.disconnect();
    this.root.removeEventListener('scroll', this.onScroll);
    cancelAnimationFrame(this.raf);
  }
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
