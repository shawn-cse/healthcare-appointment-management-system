ALTER TABLE hospital_doctorprofile ADD COLUMN IF NOT EXISTS report_within_days integer NOT NULL DEFAULT 30;
ALTER TABLE hospital_doctorprofile ADD COLUMN IF NOT EXISTS accepted_payment_methods varchar(20) NOT NULL DEFAULT 'cash,online';
ALTER TABLE hospital_doctorprofile ADD COLUMN IF NOT EXISTS booking_window_hours integer;
ALTER TABLE hospital_appointment ADD COLUMN IF NOT EXISTS guest_age smallint;
ALTER TABLE hospital_appointment ADD COLUMN IF NOT EXISTS guest_gender varchar(10);
ALTER TABLE hospital_appointment ADD COLUMN IF NOT EXISTS accepted_payment_methods varchar(20) NOT NULL DEFAULT 'cash,online';
ALTER TABLE hospital_appointment ADD COLUMN IF NOT EXISTS commission_mode varchar(10);
ALTER TABLE hospital_appointment ADD COLUMN IF NOT EXISTS commission_value decimal(9,2);
ALTER TABLE hospital_appointment ADD COLUMN IF NOT EXISTS payment_deadline_hours integer;
