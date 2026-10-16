-- Bank transfer accounts (Bancolombia, Davivienda, ...) shown to guests; stored as a JSON array.
ALTER TABLE public.tenant ADD COLUMN IF NOT EXISTS payment_bank_accounts text;
