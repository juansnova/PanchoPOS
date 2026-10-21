-- Prepayment, cancellation policy text and guest birthdays are no longer used:
-- turn them off and erase what was stored.
UPDATE public.tenant
SET reservation_prepayment_cents = NULL,
    reservation_prepayment_text = NULL,
    reservation_cancellation_policy = NULL,
    guest_birthday_capture_enabled = false,
    guest_birthday_marketing_enabled = false,
    guest_birthday_consent_text = NULL;

UPDATE public.reservation
SET guest_birthday_month = NULL,
    guest_birthday_day = NULL,
    guest_birthday_marketing_consent = false
WHERE guest_birthday_month IS NOT NULL
   OR guest_birthday_day IS NOT NULL
   OR guest_birthday_marketing_consent;
