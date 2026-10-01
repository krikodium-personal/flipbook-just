// Genera un PDF de catálogo de prueba + sus hotspots, en public/sample/.
// Uso: npm run sample
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';

const W = 595;
const H = 842;
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const GREEN = hex('#8a9a5b');
const INK = hex('#333333');

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const hotspots = [];

const newPage = (bg = '#fbf8f1') => {
  const p = doc.addPage([W, H]);
  p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex(bg) });
  return p;
};

// Bloque de producto dentro de un rectángulo (coordenadas desde arriba a la izquierda)
function product(page, pageNum, { x, y, w, h }, { code, name, tagline, color, sale = false }) {
  const top = H - y;
  page.drawRectangle({ x, y: top - h, width: w, height: h, color: hex('#ffffff') });
  // "foto" del producto: frasco estilizado
  const bw = Math.min(w * 0.3, 120);
  const bh = h * 0.55;
  const bx = x + w - bw - 30;
  const by = top - h + 40;
  page.drawRectangle({ x: bx + bw * 0.3, y: by + bh, width: bw * 0.4, height: 22, color: hex('#555555') });
  page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: hex(color) });
  page.drawRectangle({ x: bx + 10, y: by + bh * 0.35, width: bw - 20, height: bh * 0.3, color: rgb(1, 1, 1), opacity: 0.9 });
  // textos
  const size = w > 400 ? 30 : 20;
  page.drawText(name.toUpperCase(), { x: x + 28, y: top - 60, size, font: bold, color: INK, maxWidth: w - bw - 80, lineHeight: size * 1.15 });
  page.drawText(tagline, { x: x + 28, y: top - 60 - size * 3.6, size: size * 0.8, font, color: GREEN });
  page.drawText(`Código ${code}`, { x: x + 28, y: top - h + 30, size: 10, font, color: INK });
  // hotspot sugerido: al lado del nombre del producto
  hotspots.push({ id: `h${hotspots.length + 1}`, page: pageNum, x: +((x + 40) / W).toFixed(4), y: +((y + h * 0.62) / H).toFixed(4), code, sale });
}

// Productos reales de Directus (distintos casos: 1 variante, 2 variantes, sin variantes, solo slug)
const P = {
  manzanilla: { code: '1014', name: 'Aceite esencial de Eucalipto', tagline: 'El placer de respirar libremente', color: '#3f9b8f' },
  a31: { code: '3000', name: 'Óleo 31', tagline: 'Dos presentaciones', color: '#6b4a2b' },
  calendula: { code: '2201', name: 'Anti-Stress', tagline: 'Relajante natural', color: '#7b6bb0', sale: true },
  eucalipto: { code: '1017', name: 'Aceite esencial de Romero', tagline: 'Energía renovada', color: '#5f8a3a' },
  rosa: { code: 'aceite-manzanilla', name: 'Aceite esencial de Manzanilla', tagline: 'Reconfortante natural', color: '#e0b43c' },
};

// 1. Tapa
let p = newPage('#ffffff');
p.drawText('Just', { x: 230, y: 720, size: 64, font: bold, color: hex('#1f4e9c') });
p.drawText('Catálogo de productos 2026', { x: 110, y: 640, size: 30, font, color: GREEN });
p.drawRectangle({ x: 60, y: 160, width: W - 120, height: 430, color: hex('#dfe8d0') });
p.drawText('DEMO — datos de prueba', { x: 180, y: 110, size: 18, font: bold, color: INK });

// 2. Intro
p = newPage();
p.drawText('Bienvenida', { x: 60, y: 740, size: 36, font: bold, color: INK });
p.drawText('Tocá el botón + sobre cada producto para ver su ficha\ny agregarlo al carrito.', { x: 60, y: 680, size: 16, font, color: INK, lineHeight: 22 });

// 3. Producto a página completa
p = newPage();
product(p, 3, { x: 40, y: 60, w: W - 80, h: H - 120 }, P.manzanilla);

// 4. Dos productos
p = newPage();
product(p, 4, { x: 40, y: 50, w: W - 80, h: 350 }, P.a31);
product(p, 4, { x: 40, y: 440, w: W - 80, h: 350 }, P.calendula);

// 5. Dos productos
p = newPage();
product(p, 5, { x: 40, y: 50, w: W - 80, h: 350 }, P.eucalipto);
product(p, 5, { x: 40, y: 440, w: W - 80, h: 350 }, P.rosa);

// 6. Contratapa
p = newPage('#8a9a5b');
p.drawText('Gracias', { x: 220, y: 420, size: 40, font: bold, color: rgb(1, 1, 1) });

await mkdir('public/sample', { recursive: true });
await writeFile('public/sample/catalogo-demo.pdf', await doc.save());
await writeFile('public/sample/hotspots-demo.json', JSON.stringify(hotspots, null, 2) + '\n');
console.log(`OK: ${doc.getPageCount()} páginas, ${hotspots.length} hotspots → public/sample/`);
