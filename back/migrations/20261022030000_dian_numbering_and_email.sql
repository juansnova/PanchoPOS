-- DIAN (Factus): numbering range and email delivery per tenant; the provider-side client id column was
-- never used (credentials live in the server environment).
ALTER TABLE public.tenant
    ADD COLUMN IF NOT EXISTS dian_numbering_range_id integer,
    ADD COLUMN IF NOT EXISTS dian_send_email boolean NOT NULL DEFAULT true,
    DROP COLUMN IF EXISTS dian_client_id;
