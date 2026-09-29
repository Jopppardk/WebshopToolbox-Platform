-- Readable feed links: /feeds/<webshop folder>/<file name>.xml. Each webshop gets one folder,
-- unique across the platform; file names are unique within the webshop. Existing token links
-- keep working. Additive only.
CREATE TABLE feed_folders (
 company_id TEXT NOT NULL,
 webshop_id TEXT NOT NULL,
 slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 1 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,webshop_id),
 FOREIGN KEY(company_id,webshop_id) REFERENCES webshops(company_id,id)
);
ALTER TABLE product_feeds ADD COLUMN file_name TEXT CHECK(file_name IS NULL OR (length(file_name) BETWEEN 1 AND 60 AND file_name NOT GLOB '*[^a-z0-9-]*'));
CREATE UNIQUE INDEX product_feeds_file_name ON product_feeds(company_id,webshop_id,file_name) WHERE file_name IS NOT NULL;
