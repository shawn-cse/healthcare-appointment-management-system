ALTER TABLE hospital_paymenttransaction ADD COLUMN IF NOT EXISTS checkout_url text;
CREATE UNIQUE INDEX IF NOT EXISTS unique_verified_appointment_charge ON hospital_paymenttransaction (appointment_id) WHERE kind = 'charge' AND status = 'verified';
