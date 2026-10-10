-- Private relay metadata only. Contents and end-to-end encryption keys never enter D1.
CREATE TABLE IF NOT EXISTS bridge_relay_channels (
  id TEXT PRIMARY KEY,
  owner_device_id TEXT NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  mac_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_relay_owner_idx ON bridge_relay_channels(owner_device_id, expires_at);
