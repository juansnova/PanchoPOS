-- Temporarily hide a product from the customer menu without deleting it.
ALTER TABLE public.product ADD COLUMN IF NOT EXISTS out_of_stock boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenantproduct ADD COLUMN IF NOT EXISTS out_of_stock boolean NOT NULL DEFAULT false;
