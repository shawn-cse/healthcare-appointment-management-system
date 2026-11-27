ALTER TABLE hospital_refundrequest ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '';
ALTER TABLE hospital_refundrequest ADD COLUMN IF NOT EXISTS evidence_file varchar(100);
