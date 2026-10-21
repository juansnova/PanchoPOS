-- Prepayment, cancellation policy text and guest birthdays were removed from the product.
ALTER TABLE public.tenant
    DROP COLUMN IF EXISTS reservation_prepayment_cents,
    DROP COLUMN IF EXISTS reservation_prepayment_text,
    DROP COLUMN IF EXISTS reservation_cancellation_policy,
    DROP COLUMN IF EXISTS guest_birthday_capture_enabled,
    DROP COLUMN IF EXISTS guest_birthday_marketing_enabled,
    DROP COLUMN IF EXISTS guest_birthday_consent_text;

ALTER TABLE public.reservation
    DROP COLUMN IF EXISTS guest_birthday_month,
    DROP COLUMN IF EXISTS guest_birthday_day,
    DROP COLUMN IF EXISTS guest_birthday_marketing_consent;
