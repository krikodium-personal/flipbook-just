# Flipbook de catálogo — prototipo

> Para retomar el trabajo, leer primero [MEMORY.md](MEMORY.md): decisiones tomadas, advertencias y preguntas abiertas.

Réplica del catálogo interactivo de iPaper, con tres cambios de fondo:

1. **Subís un PDF** y marcás los productos sobre cada página (editor propio).
2. **La ficha de producto sale del CMS (Directus)**, no de una planilla.
3. **"Agregar al carrito" usa el carrito real de Shopify** y el checkout es el de Shopify.

> Estado: **prototipo**. La ficha de producto se lee del **Directus real**
> (`https://directus.krikorian.ar`, rol Public, sin token). El carrito todavía es simulado.
> Los catálogos se guardan en **Cloudflare**: configuración en D1, PDFs en R2, API en Pages Functions.

## Correr en local

Hacen falta dos procesos: Vite (frontend) y `wrangler pages dev` (API + D1/R2 emulados en `.wrangler/`).

```bash
npm install
npm run build              # wrangler sirve la API junto a dist/
npm run dev:api            # API en http://localhost:8788
npm run dev                # http://localhost:5173 → /admin/ (Vite redirige /api a la API)
npm run sample             # regenera public/sample/ (PDF demo + hotspots)
```

`.dev.vars` tiene `ALLOW_UNAUTHENTICATED=1` para que la API de administración funcione sin Access en local.

**En local se usan los datos de producción.** En `wrangler.toml`, D1 y R2 tienen `remote = true`: `npm run dev:api`
se conecta a la base y los PDFs reales de Cloudflare (hace falta `npx wrangler login`). Todo lo que se cree, edite o
borre en localhost cambia producción. Para trabajar con datos de prueba, quitar esas dos líneas `remote = true` y
correr `npm run db:migrate:local` (usa el emulador en `.wrangler/`).

### Direcciones

| Dirección | Qué es | Acceso |
|---|---|---|
| `/admin/` | Listado de catálogos (crear, eliminar) | Protegido con Cloudflare Access |
| `/admin/editor.html?id=…` | Editor | Protegido con Cloudflare Access |
| `/catalogo.html?id=…` | Visor | Público |
| `/api/admin/*` | API de escritura | Access + verificación del token en la función |
| `/api/public/catalogs/:id[/pdf]` | Lectura para el visor | Público |

## Publicar en Cloudflare

Una sola vez:

```bash
npx wrangler login                                        # abre el navegador para autorizar
npx wrangler d1 create flipbook-catalogo                  # copiar el database_id a wrangler.toml
npx wrangler r2 bucket create flipbook-catalogo-pdfs      # requiere R2 habilitado en la cuenta
npm run db:migrate:remote
npx wrangler pages project create flipbook-catalogo --production-branch main
```

Cada vez que se quiera publicar: `npm run cf:deploy`.

### Proteger la administración (Cloudflare Access)

Hasta configurar esto, la API de administración responde 503 a todo (falla cerrada) y el visor funciona igual.

1. Zero Trust → Access → Applications → Add → **Self-hosted**.
2. Dominio `flipbook-catalogo.pages.dev` con las rutas `admin/*` y `api/admin/*`. Agregar también
   `*.flipbook-catalogo.pages.dev` con las mismas rutas, para cubrir los deploys de preview.
3. Política **Allow** con los emails autorizados (login con código por mail).
4. Copiar el **Application Audience (AUD) Tag** y el dominio del equipo (`https://<equipo>.cloudflareaccess.com`)
   a `ACCESS_AUD` y `ACCESS_TEAM_DOMAIN` en `wrangler.toml`, y volver a publicar.

## Cómo está armado

```
admin/index.html / src/home.js      Listado de catálogos, crear desde PDF (o soltándolo), demo, eliminar
admin/editor.html / src/editor.js   Editor (productos, áreas de enlace, título, actualizar PDF)
catalogo.html / src/viewer.js       Visor público: flipbook, "+", ficha, carrito, contenido
functions/api/                      API (Pages Functions): admin/ protegida, public/ de lectura
migrations/                         Esquema de D1
src/lib/pdf.js                PDF → imágenes por página (pdf.js)
src/lib/store.js              Cliente de la API (catálogos en Cloudflare)
src/lib/local-store.js        Legado: catálogos guardados en IndexedDB por versiones viejas (para subirlos)
src/adapters/products.js      Fuente de producto: Directus REST (default) | mock sin conexión
src/adapters/shopify.js       Carrito: mock (default) | Ajax Cart API del tema Shopify
src/config.js                 VITE_PRODUCTS_SOURCE, VITE_CART, VITE_DIRECTUS_URL/TOKEN/MARKET
```

### Diseño: Just ecommerce Design System

La interfaz usa el **Just ecommerce Design System** de Claude Design
(https://claude.ai/artifact/XwKHYX1c6Kf7ADicNssfEf), el mismo de la tienda online.

- `src/tokens.css`: tokens copiados tal cual del design system (colores, tipografía, espaciados, radios, sombras) +
  `@font-face` de las fuentes con licencia que provee (`public/fonts/`: FreightText Pro Medium Italic y Neue Haas
  Grotesk Display Pro 400 / 400 itálica / 500). Logo oficial en `public/brand/just-logo.svg`.
- `src/styles.css`: roles de la app (`--bg`, `--cta`, `--ink`…) sobre esos tokens, y al final una capa de
  componentes que replica los del DS: Button (Primary oscuro / Secondary crema), IconButton, Pill (presentaciones),
  SelectorInput (cantidad), Tab, PromoTag ("Oferta"), TextField.
- Fondo crema, títulos en serif itálica, solo pesos 400/500, sombras exactas del DS.
- Excepción pedida: los "+" de los hotspots mantienen sus colores propios (azul `#045e8b`, rojo `#fc565b`).
- Los íconos siguen siendo los propios de la app (trazo fino): el DS tampoco tiene los SVG reales todavía
  (usa Material Symbols como reemplazo).

Cada página tiene dos tipos de elementos (todos en `catalog.hotspots`, posiciones relativas 0 a 1):

- **Producto** `{ page, x, y, code, sale }`: el "+" (o "%" si `sale`) que abre la ficha. `code` es la clave del producto.
- **Enlace a página** `{ type: 'link', page, x, y, w, h, target }`: área rectangular invisible (se resalta al pasar
  el mouse) que lleva a la página `target` del mismo catálogo. Se dibuja en el editor con la herramienta
  "Área → página".

**Actualizar el PDF** (editor → "Actualizar PDF"): reemplaza el PDF del mismo catálogo. Se conservan el título, los
enlaces y los productos cargados a mano; los productos que vinieron de la capa "Products ID" se vuelven a leer del PDF
nuevo, y se quitan los elementos de páginas que ya no existen.

**Códigos desde el PDF:** si el PDF tiene una capa llamada **"Products ID"** (puede estar oculta), al subirlo se crea
un "+" por cada texto de esa capa, centrado donde está el texto y con ese texto como código. También se puede correr
a mano con "Detectar códigos del PDF" en el editor; no duplica los que ya existen. Ver `extractLayerText` en
`src/lib/pdf.js`.

### Modelo de Directus que se usa

| Colección | Campos usados |
|---|---|
| `products` | `name`, `description_short` (bajada), `description_long`, `benefits`, `gallery_items` (fotos), `photo` (respaldo), `product_code`, `slug`, `ecommerce_url` |
| `product_variants` | `code` (**código del catálogo**), `product_id`, `variant_id`, `prices` |
| `variants` | `capacity_value` + `capacity_unit` (ej. "20 ml") o `name` |
| `prices` | `price` por `market`. Se muestra el mercado `VITE_DIRECTUS_MARKET` (default `1`, **supuesto: Argentina**) |

El "+" guarda una clave que se busca en este orden: `product_variants.code` → `products.product_code` → `products.slug`
→ `#<id>`. Si la clave es el código de una variante, la ficha abre con esa presentación elegida.

### Estado de los datos en Directus (relevado el 2026-09-30)

- 39 productos, 20 variantes con código y precio (18 productos). Solo 2 productos tienen más de una presentación.
- 21 productos no tienen variantes, así que **no tienen precio** y la ficha dice "no disponible para comprar".
- 27 productos no tienen `product_code`. Algunos tampoco tienen `slug` y solo se pueden vincular por `#id`.
- La colección `markets` no es pública, así que no se pudo confirmar que el mercado 1 sea Argentina.
- **No hay ningún campo que relacione con Shopify.** Propuesta: agregar `shopify_variant_id` en `product_variants`
  (los SKUs de Shopify no coinciden con los códigos). El adaptador ya lo lee si existe.

### Precio

Hoy se muestra el precio de Directus. Cuando el carrito sea el de Shopify, el checkout cobra el precio de Shopify.
Si difieren, el cliente ve uno y paga otro. Hay que definir cuál es la fuente de verdad o leer el precio desde Shopify.

## Pasar a producción (dentro del tema Shopify)

Decidido: el flipbook vive **dentro del tema** para compartir el carrito nativo de la tienda.

1. **Pre-renderizar el PDF.** Hoy se renderiza en el navegador de cada visitante, lo que es lento con 70+ páginas.
   Hay que renderizar una sola vez al publicar (script o función) y subir las imágenes a Shopify Files o a un CDN.
2. **Guardar los catálogos en Directus** (colección `catalogs`: nombre, imágenes de páginas, hotspots JSON), en
   lugar de IndexedDB. El editor escribe ahí y el visor lee de ahí.
3. **Sección del tema:** `sections/flipbook.liquid` + el JS del visor como asset, con `VITE_CART=shopify`.
   El adaptador ya usa `/cart.js`, `/cart/add.js` y `/cart/change.js`.
4. **Integrar con el carrito del tema:** en lugar del carrito lateral propio, abrir el cart drawer del tema.
   Depende del tema: Dawn y derivados exponen `cart-drawer` y escuchan eventos. Hay que ver cuál usan.
5. **CORS en Directus:** hoy acepta `localhost`. Hay que confirmar que acepte el dominio de la tienda.

## Pendiente respecto de iPaper

- Zoom sobre la página (pinch y doble clic).
- Índice/miniaturas, búsqueda y botón de compartir.
- Estadísticas de clics en productos (iPaper las registra).
