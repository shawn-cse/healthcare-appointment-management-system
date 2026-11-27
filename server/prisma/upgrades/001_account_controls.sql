ALTER TABLE hospital_user ADD COLUMN IF NOT EXISTS login_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE hospital_user ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
ALTER TABLE hospital_user ADD COLUMN IF NOT EXISTS gender varchar(10);
ALTER TABLE hospital_doctorprofile ADD COLUMN IF NOT EXISTS professional_experience text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_username_case_insensitive ON hospital_user (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_email_case_insensitive ON hospital_user (lower(email)) WHERE email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS unique_patient_normalized_phone ON hospital_user ((CASE WHEN ltrim(phone, '+') ~ '^01[0-9]{9}$' THEN '88' || ltrim(phone, '+') ELSE ltrim(phone, '+') END)) WHERE role = 'patient' AND phone IS NOT NULL AND phone <> '';
UPDATE hospital_user SET phone = CASE WHEN ltrim(phone, '+') ~ '^8801[0-9]{9}$' THEN substring(ltrim(phone, '+') from 3) ELSE ltrim(phone, '+') END WHERE phone ~ '^\+?[0-9]{10,15}$';
