-- Staff-entered additional charge on an order (extra item, price change that day, etc.).
ALTER TABLE public."order" ADD COLUMN IF NOT EXISTS extra_charge_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public."order" ADD COLUMN IF NOT EXISTS extra_charge_note character varying(200);
