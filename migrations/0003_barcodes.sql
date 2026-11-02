-- Optional fields stay in product JSON; existing products and lots are preserved.
CREATE UNIQUE INDEX product_barcode_unique
ON records(json_extract(data,'$.barcode'))
WHERE kind='product' AND deleted=0 AND json_extract(data,'$.barcode') IS NOT NULL;
CREATE TABLE barcode_cache (
  barcode TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  expires_at INTEGER NOT NULL
);
CREATE INDEX barcode_cache_expiry ON barcode_cache(expires_at);
CREATE TABLE barcode_lookup_budget (
  id INTEGER PRIMARY KEY CHECK(id=1),
  minute INTEGER NOT NULL,
  used INTEGER NOT NULL
);
INSERT INTO barcode_lookup_budget(id,minute,used) VALUES(1,0,0);
