# Memoria del proyecto — Flipbook de catálogo Swiss Just

Contexto para retomar el trabajo. El detalle técnico (cómo correrlo, arquitectura, modelo de Directus) está en el [README](README.md); acá van las decisiones, lo que ya se aprendió a los golpes y lo que falta.

Última actualización: 2026-10-01.

## Qué es

Réplica del catálogo interactivo de iPaper de Swiss Just (viewer.ipaper.io/swiss-just/-catalogos-interactivos/argentina/...):
- se sube un PDF y se marcan productos (hotspots) y áreas de link sobre las páginas;
- la ficha de cada producto sale de **Directus** (antes salía de un Google Sheets);
- el carrito tiene que terminar siendo el de **Shopify**, con el checkout de Shopify.

Hoy es un **prototipo**: el carrito es simulado (localStorage) y los precios salen de Directus.

## Decisiones tomadas (no volver a discutir)

| Tema | Decisión | Fecha |
|---|---|---|
| CMS | Directus (Cloudflare Containers + Neon, migrado desde Railway el 2026-11): `https://directus.krikorian.ar` | 2026-09-30 |
| Shopify | La tienda existe pero los SKUs **no coinciden** con los códigos del catálogo → la equivalencia irá en Directus (`shopify_variant_id` por variante; el campo todavía no existe) | 2026-09-30 |
| Destino final | El flipbook vive **dentro del tema de Shopify** (Ajax Cart API). El adaptador ya está en `src/adapters/shopify.js`, sin usar | 2026-09-30 |
| Etapa | Prototipo primero, producción después | 2026-09-30 |
| Hosting | Todo en Cloudflare: Pages + Pages Functions, D1 (`flipbook-catalogo`), R2 (`flipbook-catalogo-pdfs`) | 2026-09-30 |
| Acceso al admin | Cloudflare Access (team `misty-snow-1693`). La API admin verifica el JWT y falla cerrada | 2026-09-30 |
| Diseño | "Just ecommerce Design System" (artifact de Claude Design `XwKHYX1c6Kf7ADicNssfEf`). Tokens copiados en `src/tokens.css`, fuentes en `public/fonts/` | 2026-09-30 |
| Editor | Solo escritorio; en celular muestra un aviso y no carga | 2026-09-30 |
| Visor en celular | Una página por vez, sin efecto de hoja, zoom con doble toque | 2026-09-30 |

## Direcciones

- Producción: https://flipbook-catalogo.pages.dev — admin en `/admin/`, visor en `/catalogo.html?id=<id>`.
- Catálogo real cargado: id `cmuogaaeu0d2f27` ("Catálogo de Productos Argentina 2025", 78 páginas).
- Local: `npm run dev` (Vite, puerto 5188) + `npm run dev:api` (Wrangler, puerto 8788).

## Cuidado

- **Local escribe en PRODUCCIÓN.** `wrangler.toml` tiene D1 y R2 con `remote = true`. Cualquier guardado desde localhost modifica el catálogo real. No hacer pruebas que escriban; si se hace alguna, revertirla enseguida.
- **No elegir títulos ni contenidos por Christian**: hubo títulos de prueba que hubo que revertir.
- **Publicar solo cuando Christian dice "publicar"**: `npm run cf:deploy`. Después de publicar, comprobar que `https://flipbook-catalogo.pages.dev/catalogo` sirva el CSS nuevo (`assets/ui-<hash>.css` igual al de `dist/`); la dirección principal puede tardar unos segundos en actualizarse.
- Repo git: https://github.com/krikodium-personal/flipbook-just (**público**, rama `main`). Commit y push solo cuando Christian lo pide. Las fuentes del DS (licencia comercial) están subidas por decisión de Christian (2026-10-01).
- `window.confirm` no funciona en el navegador embebido de Claude: se usa el `confirmDialog` propio de `src/lib/ui.js`.
- En el navegador embebido oculto, pdf.js renderiza muy lento (≈1 s por página): es del entorno de prueba, no del código.
- No leer `~/.railway/config.json` (bloqueado como exploración de credenciales).

## Cómo funciona lo que no es obvio

- **Carga progresiva del PDF en el visor**: pdf.js con un `PDFDataRangeTransport` propio (pedidos por rango a R2), de a 5 páginas; carga el lote siguiente cuando el lector está en la anteúltima cargada. La tapa aparece con ~2 MB descargados en vez de 20 MB.
- **Índice (bookmarks)**: se calcula en el editor al abrir el PDF y se guarda en D1 (`catalogs.outline`), para que el visor no tenga que bajar el PDF entero.
- **Códigos de producto desde el PDF**: el editor lee la capa (OCG) "Products ID" del PDF y crea los hotspots solos. Al reemplazar el PDF se conservan título, links y productos agregados a mano.
- **Búsqueda en Directus** de un código de hotspot: `product_variants.code` → `products.product_code` → `slug` → `#id`.
- **Modal de producto en escritorio**: altura fija; la descripción se desplaza por dentro. Fotos cuadradas, miniaturas en columna a la izquierda; columna de fotos 3fr y descripción 2fr (mín. 340 px). Si hay una sola foto, la columna de la foto mide lo justo para el cuadrado y la descripción usa el resto.

## Preguntas abiertas para Christian

1. ¿La licencia de las fuentes del DS (FreightText Pro, Neue Haas Grotesk) cubre uso web?
2. Variantes de tamaño: ¿botones (pills) o desplegable "Tamaño"?
3. ¿De dónde salen precio y oferta en producción? (Hoy: Directus, `market` 1, supuesto = Argentina, sin confirmar.)
4. Códigos del PDF que no existen en Directus: solo 17 de 121 códigos distintos se encuentran (faltan los MEZ, SET, Popup y ~80 numéricos). ¿Se cargan en Directus o hay otra fuente?
5. ¿Ocultar los hotspots cuyo código no existe en el CMS?

## Pendiente para producción

- Campo `shopify_variant_id` en Directus y activar el adaptador de carrito de Shopify.
- Llevar el visor al tema de Shopify (sección/plantilla) en vez de Cloudflare Pages.
- Ver "Pendiente respecto de iPaper" en el README.
