-- Catálogos: la configuración vive acá; el PDF en R2 (clave pdfs/<id>.pdf)
CREATE TABLE IF NOT EXISTS catalogs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,              -- nombre del archivo PDF original
  title       TEXT,                       -- título elegido en el editor (NULL → se muestra name)
  pages       INTEGER,
  cover       TEXT,                       -- portada chica (data URL JPEG)
  hotspots    TEXT NOT NULL DEFAULT '[]', -- JSON: productos y enlaces
  products    INTEGER NOT NULL DEFAULT 0, -- contadores para el listado
  links       INTEGER NOT NULL DEFAULT 0,
  pdf_size    INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS catalogs_updated ON catalogs (updated_at DESC);
