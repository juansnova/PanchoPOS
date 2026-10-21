-- End-of-day cash register closes.
CREATE TABLE IF NOT EXISTS public.cash_close (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    business_date date NOT NULL,
    orders_count integer NOT NULL DEFAULT 0,
    expected_cash_cents integer NOT NULL DEFAULT 0,
    expected_card_cents integer NOT NULL DEFAULT 0,
    expected_transfer_cents integer NOT NULL DEFAULT 0,
    expected_other_cents integer NOT NULL DEFAULT 0,
    tips_cents integer NOT NULL DEFAULT 0,
    opening_float_cents integer NOT NULL DEFAULT 0,
    counted_cash_cents integer NOT NULL DEFAULT 0,
    difference_cents integer NOT NULL DEFAULT 0,
    note varchar(500),
    closed_by_user_id integer REFERENCES public."user"(id) ON DELETE SET NULL,
    closed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cash_close_tenant_date ON public.cash_close (tenant_id, business_date);
