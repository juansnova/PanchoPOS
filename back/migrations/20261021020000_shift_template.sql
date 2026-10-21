-- Reusable shift templates (Apertura, Cierre, Partido...) for the working plan grid.
CREATE TABLE IF NOT EXISTS public.shift_template (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    name varchar(40) NOT NULL,
    start_time varchar(5) NOT NULL,
    end_time varchar(5) NOT NULL,
    start_time2 varchar(5),
    end_time2 varchar(5),
    sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_shift_template_tenant ON public.shift_template (tenant_id);
