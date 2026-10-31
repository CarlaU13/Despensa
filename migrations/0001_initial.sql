CREATE TABLE records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('location','product','lot','shopping')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  version INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
);
CREATE INDEX records_kind ON records(kind, deleted);
CREATE INDEX lot_product ON records(json_extract(data,'$.product_id')) WHERE kind='lot' AND deleted=0;
CREATE INDEX lot_location ON records(json_extract(data,'$.location_id')) WHERE kind='lot' AND deleted=0;
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  before_data TEXT,
  before_deleted INTEGER NOT NULL,
  before_version INTEGER NOT NULL,
  after_version INTEGER NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  group_id TEXT
);
CREATE INDEX history_time ON history(created_at DESC);
CREATE TABLE mutation_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  credential_version TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TRIGGER validate_lot_insert BEFORE INSERT ON records
WHEN NEW.kind='lot' AND NEW.deleted=0
BEGIN
  SELECT RAISE(ABORT, 'invalid_product') WHERE NOT EXISTS (
    SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.product_id') AND kind='product' AND deleted=0
  );
  SELECT RAISE(ABORT, 'invalid_location') WHERE json_extract(NEW.data,'$.location_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.location_id') AND kind='location' AND deleted=0
  );
END;
CREATE TRIGGER validate_lot_update BEFORE UPDATE ON records
WHEN NEW.kind='lot' AND NEW.deleted=0
BEGIN
  SELECT RAISE(ABORT, 'invalid_product') WHERE NOT EXISTS (
    SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.product_id') AND kind='product' AND deleted=0
  );
  SELECT RAISE(ABORT, 'invalid_location') WHERE json_extract(NEW.data,'$.location_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.location_id') AND kind='location' AND deleted=0
  );
END;
CREATE TRIGGER protect_references BEFORE UPDATE ON records
WHEN NEW.deleted=1 AND OLD.deleted=0 AND OLD.kind IN ('product','location')
BEGIN
  SELECT RAISE(ABORT, 'in_use') WHERE EXISTS (
    SELECT 1 FROM records WHERE kind='lot' AND deleted=0 AND (
      (OLD.kind='product' AND json_extract(data,'$.product_id')=OLD.id) OR
      (OLD.kind='location' AND json_extract(data,'$.location_id')=OLD.id)
    )
  );
  SELECT RAISE(ABORT, 'in_use') WHERE OLD.kind='product' AND EXISTS (
    SELECT 1 FROM records WHERE kind='shopping' AND deleted=0 AND json_extract(data,'$.product_id')=OLD.id
  );
END;
CREATE TRIGGER protect_unit BEFORE UPDATE ON records
WHEN NEW.kind='product' AND json_extract(NEW.data,'$.unit') != json_extract(OLD.data,'$.unit')
BEGIN
  SELECT RAISE(ABORT, 'unit_in_use') WHERE EXISTS (
    SELECT 1 FROM records WHERE kind='lot' AND deleted=0 AND json_extract(data,'$.product_id')=OLD.id
  );
END;
CREATE TRIGGER validate_shopping_insert BEFORE INSERT ON records
WHEN NEW.kind='shopping' AND NEW.deleted=0 AND json_extract(NEW.data,'$.product_id') IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid_product') WHERE NOT EXISTS (
    SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.product_id') AND kind='product' AND deleted=0
  );
END;
CREATE TRIGGER validate_shopping_update BEFORE UPDATE ON records
WHEN NEW.kind='shopping' AND NEW.deleted=0 AND json_extract(NEW.data,'$.product_id') IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid_product') WHERE NOT EXISTS (
    SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.product_id') AND kind='product' AND deleted=0
  );
END;
