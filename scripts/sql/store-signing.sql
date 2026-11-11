-- Store authentication by signed requests. Additive only: one nullable column and one new table.
-- Run it before deploying code that reads them. `pnpm db:push` makes the same change from the Drizzle schema.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS signing_key text;

CREATE TABLE IF NOT EXISTS store_request_ids (
  merchant_id text NOT NULL,
  request_id text NOT NULL,
  seen_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT store_request_ids_merchant_id_request_id_pk PRIMARY KEY (merchant_id, request_id)
);
