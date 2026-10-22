-- Stock notices for the administrator (ingredient out / running low). The system no longer hides
-- dishes on its own: the admin decides (withdraw, keep selling, register incoming stock).
CREATE TABLE IF NOT EXISTS public.inventory_alert (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES public.tenant(id),
    inventory_item_id integer NOT NULL REFERENCES public.inventory_item(id),
    kind character varying(8) NOT NULL,
    status character varying(12) NOT NULL DEFAULT 'open',
    quantity_snapshot numeric(12,4) NOT NULL DEFAULT 0,
    product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    withdrawn_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    decided_at timestamp without time zone,
    decided_by_user_id integer REFERENCES public."user"(id),
    resolved_at timestamp without time zone
);
CREATE INDEX IF NOT EXISTS ix_inventory_alert_item ON public.inventory_alert (inventory_item_id);
CREATE INDEX IF NOT EXISTS ix_inventory_alert_status ON public.inventory_alert (status);
CREATE INDEX IF NOT EXISTS ix_inventory_alert_tenant ON public.inventory_alert (tenant_id);
-- One live notice per ingredient and kind
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_alert_live
    ON public.inventory_alert (inventory_item_id, kind)
    WHERE status IN ('open', 'kept', 'withdrawn', 'restocked');
