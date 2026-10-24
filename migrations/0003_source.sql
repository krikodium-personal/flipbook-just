-- Fuente de la ficha de producto de cada catálogo: 'directus' (Just) o 'arbell' (arbell.com.ar).
ALTER TABLE catalogs ADD COLUMN source TEXT NOT NULL DEFAULT 'directus';
