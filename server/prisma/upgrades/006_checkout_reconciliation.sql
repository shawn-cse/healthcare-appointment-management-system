ALTER TABLE hospital_paymenttransaction ADD COLUMN IF NOT EXISTS gateway_session_key varchar(90);
