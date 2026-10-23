-- DIAN (Factus): low-package alert state per tenant (email sent once; administrator confirmation).
ALTER TABLE public.tenant
    ADD COLUMN IF NOT EXISTS dian_package_alert_emailed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS dian_package_alert_acked boolean NOT NULL DEFAULT false;
