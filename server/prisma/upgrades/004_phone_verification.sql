ALTER TABLE hospital_user ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
CREATE TABLE IF NOT EXISTS hospital_phonechallenge (
  user_id bigint PRIMARY KEY REFERENCES hospital_user(id) ON DELETE CASCADE,
  phone varchar(16) NOT NULL, code_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL, sent_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0
);
