-- Optional reason for waste / manual adjustments (spoiled, broken, expired, ...).
ALTER TABLE public.inventory_transaction ADD COLUMN IF NOT EXISTS reason varchar(24);
