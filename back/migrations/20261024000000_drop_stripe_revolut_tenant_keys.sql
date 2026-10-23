-- Stripe and Revolut are no longer used: drop the per-tenant API keys.
ALTER TABLE public.tenant
    DROP COLUMN IF EXISTS stripe_secret_key,
    DROP COLUMN IF EXISTS stripe_publishable_key,
    DROP COLUMN IF EXISTS revolut_merchant_secret;
