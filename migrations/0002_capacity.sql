-- Preserve all existing records. A transaction-safe counter avoids a full
-- inventory scan on every purchase and also covers receive, split and undo.
CREATE TABLE inventory_meta (
  id INTEGER PRIMARY KEY CHECK(id=1),
  active_count INTEGER NOT NULL,
  CONSTRAINT capacity_limit CHECK(active_count BETWEEN 0 AND 50000)
);
INSERT INTO inventory_meta(id,active_count)
SELECT 1,count(*) FROM records WHERE deleted=0;
CREATE INDEX records_active ON records(deleted);
CREATE TRIGGER inventory_count_insert AFTER INSERT ON records
WHEN NEW.deleted=0
BEGIN
  UPDATE inventory_meta SET active_count=active_count+1 WHERE id=1;
END;
CREATE TRIGGER inventory_count_deleted AFTER UPDATE OF deleted ON records
WHEN NEW.deleted!=OLD.deleted
BEGIN
  UPDATE inventory_meta SET active_count=active_count+CASE WHEN NEW.deleted=0 THEN 1 ELSE -1 END WHERE id=1;
END;
CREATE TRIGGER inventory_count_remove AFTER DELETE ON records
WHEN OLD.deleted=0
BEGIN
  UPDATE inventory_meta SET active_count=active_count-1 WHERE id=1;
END;
