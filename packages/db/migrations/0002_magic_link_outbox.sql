CREATE TABLE magic_link_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX magic_link_outbox_email_idx ON magic_link_outbox (email);
