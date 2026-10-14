-- Kitchen ticket auto-print: remember which lines were already sent to the kitchen printer.
ALTER TABLE public.orderitem ADD COLUMN IF NOT EXISTS kitchen_printed_at timestamp with time zone;

-- Existing lines that already left "pending" were handled before this feature: never reprint them.
UPDATE public.orderitem
SET kitchen_printed_at = COALESCE(status_updated_at, created_at, now())
WHERE kitchen_printed_at IS NULL AND status::text <> 'pending';
