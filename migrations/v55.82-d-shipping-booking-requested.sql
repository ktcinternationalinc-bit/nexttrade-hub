-- v55.82-D — Two-stage shipping booking flow.
--
-- Why: previously the rate row had a single boolean `booked` and a single
-- text `shipment_reference`. There was no way to capture "we asked the
-- forwarder for a booking and we're waiting on the booking number" — so
-- those rates either looked unbooked (misleading; the user clearly took
-- action) or got prematurely flipped to booked (also misleading; no booking
-- number yet, can't ship).
--
-- This migration adds five columns that capture the request stage.
-- Stage 1 (booking_requested): user clicked "Request Booking", sent an
-- email or WhatsApp to the forwarder, and recorded who the request is for.
-- Stage 2 (booked, existing): forwarder replied with a booking number,
-- which is captured separately and flips booked = true.
--
-- All columns nullable / default safe. Idempotent — safe to re-run.

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS booking_requested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS booking_requested_at TIMESTAMPTZ;

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS booking_requested_customer TEXT;

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS booking_requested_order TEXT;

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS booking_requested_release TEXT;

ALTER TABLE shipping_rates
  ADD COLUMN IF NOT EXISTS booking_requested_expected_date DATE;

COMMENT ON COLUMN shipping_rates.booking_requested IS
  'true when user has emailed/WhatsApped the forwarder asking for a booking. Cleared once finalizeBookingConfirm runs and booked=true.';
COMMENT ON COLUMN shipping_rates.booking_requested_at IS
  'Timestamp of the request — used in dashboards to show how long we have been waiting.';
COMMENT ON COLUMN shipping_rates.booking_requested_customer IS
  'Customer the booking is for. Carried forward to the Confirm Booking modal as a prefill.';
COMMENT ON COLUMN shipping_rates.booking_requested_order IS
  'Our internal order number that prompted this booking request.';
COMMENT ON COLUMN shipping_rates.booking_requested_release IS
  'Customer-side release number (if known at request time).';
COMMENT ON COLUMN shipping_rates.booking_requested_expected_date IS
  'Expected cargo-ready date — sent to the forwarder so they can plan.';
