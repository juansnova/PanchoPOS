-- Seconds before a new order line moves from pending to preparing automatically (kitchen and bar).
ALTER TABLE public.tenant ADD COLUMN IF NOT EXISTS auto_preparing_seconds integer NOT NULL DEFAULT 30;
