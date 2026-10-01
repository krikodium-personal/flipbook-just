-- Índice de contenidos (marcadores del PDF) ya resuelto a números de página.
-- Lo calcula el editor una vez; el visor lo usa sin tener que recorrer el PDF.
ALTER TABLE catalogs ADD COLUMN outline TEXT;
