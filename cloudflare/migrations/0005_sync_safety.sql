-- Installation-wide, atomic admission. UTC windows survive isolates and restarts.
CREATE TABLE sync_budget (
  lane TEXT PRIMARY KEY, day TEXT NOT NULL, month TEXT NOT NULL,
  day_requests INTEGER NOT NULL, month_requests INTEGER NOT NULL,
  day_work INTEGER NOT NULL, month_work INTEGER NOT NULL,
  day_bytes INTEGER NOT NULL, month_bytes INTEGER NOT NULL
);
-- Physical keys are never reused. A failed R2 delete remains retryable in D1.
CREATE TABLE r2_delete_queue (
  object_key TEXT PRIMARY KEY, not_before TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX r2_delete_queue_due ON r2_delete_queue(not_before);
CREATE TABLE mutation_relay_cursors (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(space_id, device_id)
);
CREATE TABLE binary_objects (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, hash TEXT NOT NULL, user_id TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0, object_key TEXT NOT NULL,
  bytes INTEGER NOT NULL, created_at TEXT NOT NULL, referenced_at TEXT,
  PRIMARY KEY(space_id, kind, hash, user_id)
);
CREATE TABLE blob_uploads (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  hash TEXT NOT NULL, user_id TEXT NOT NULL, total_bytes INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL, expires_at TEXT NOT NULL,
  UNIQUE(space_id, hash, user_id)
);
CREATE TABLE blob_upload_chunks (
  upload_id TEXT NOT NULL REFERENCES blob_uploads(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL, hash TEXT NOT NULL, object_key TEXT NOT NULL,
  PRIMARY KEY(upload_id, chunk_index)
);

ALTER TABLE spaces ADD COLUMN gc_checked_at TEXT;

CREATE TABLE binary_storage_usage (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER binary_storage_insert AFTER INSERT ON binary_objects BEGIN
  INSERT INTO binary_storage_usage(space_id,bytes) VALUES(NEW.space_id,NEW.bytes)
    ON CONFLICT(space_id) DO UPDATE SET bytes=bytes+NEW.bytes;
END;
CREATE TRIGGER binary_storage_delete AFTER DELETE ON binary_objects BEGIN
  UPDATE binary_storage_usage SET bytes=bytes-OLD.bytes WHERE space_id=OLD.space_id;
END;
CREATE TRIGGER blob_reservation_insert AFTER INSERT ON blob_uploads BEGIN
  INSERT INTO binary_storage_usage(space_id,reserved) VALUES(NEW.space_id,NEW.total_bytes)
    ON CONFLICT(space_id) DO UPDATE SET reserved=reserved+NEW.total_bytes;
END;
CREATE TRIGGER blob_reservation_delete AFTER DELETE ON blob_uploads BEGIN
  UPDATE binary_storage_usage SET reserved=reserved-OLD.total_bytes WHERE space_id=OLD.space_id;
END;

ALTER TABLE mutations ADD COLUMN body_bytes INTEGER NOT NULL DEFAULT 0;
UPDATE mutations SET body_bytes=CASE WHEN body_object_key IS NOT NULL THEN 262144 ELSE LENGTH(CAST(body_json AS BLOB)) END;
CREATE TABLE mutation_ledger_usage (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL DEFAULT 0
);
INSERT INTO mutation_ledger_usage SELECT space_id,SUM(body_bytes) FROM mutations WHERE acknowledged_at IS NULL GROUP BY space_id;
CREATE TRIGGER mutation_ledger_insert AFTER INSERT ON mutations WHEN NEW.acknowledged_at IS NULL BEGIN
  INSERT INTO mutation_ledger_usage VALUES(NEW.space_id,NEW.body_bytes) ON CONFLICT(space_id) DO UPDATE SET bytes=bytes+NEW.body_bytes;
END;
CREATE TRIGGER mutation_ledger_ack AFTER UPDATE OF acknowledged_at ON mutations WHEN OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL BEGIN
  UPDATE mutation_ledger_usage SET bytes=bytes-OLD.body_bytes WHERE space_id=OLD.space_id;
END;
CREATE TRIGGER mutation_ledger_delete AFTER DELETE ON mutations WHEN OLD.acknowledged_at IS NULL BEGIN
  UPDATE mutation_ledger_usage SET bytes=bytes-OLD.body_bytes WHERE space_id=OLD.space_id;
END;
