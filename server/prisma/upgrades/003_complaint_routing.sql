ALTER TABLE hospital_complaint ADD COLUMN IF NOT EXISTS recipient_id bigint REFERENCES hospital_user(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS hospital_complaint_recipient_id_idx ON hospital_complaint (recipient_id);
