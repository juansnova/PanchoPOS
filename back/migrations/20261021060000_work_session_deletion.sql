-- Audit record kept when an owner/admin deletes a clock-in/out session.
CREATE TABLE IF NOT EXISTS public.work_session_deletion (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    user_id integer NOT NULL,
    user_name varchar(200) NOT NULL DEFAULT '',
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    deleted_by_user_id integer REFERENCES public."user"(id) ON DELETE SET NULL,
    note varchar(500) NOT NULL DEFAULT '',
    deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_work_session_deletion_tenant ON public.work_session_deletion (tenant_id, deleted_at);
