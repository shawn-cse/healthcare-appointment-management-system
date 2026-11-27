export type UserRole = 'patient' | 'doctor' | 'receptionist' | 'admin';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  role_display: string;
  first_name: string;
  last_name: string;
  display_name: string;
  phone: string;
  dob: string | null;
  nid: string;
  address: string;
  avatar: string | null;
  chamber_id?: number | null;
  room_number?: string;
  is_active: boolean;
  login_allowed: boolean;
  phone_verified: boolean;
  age: number | null;
  gender: string;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  created_at: string;
  doctor_profile_id?: number | null;
  doctor_profile?: {
    id: number;
    designation: string;
    qualifications: string;
    professional_experience: string;
    registration_number: string;
    receptionist_name: string;
    room_number: string;
    department_name: string;
  } | null;
}

export interface Department {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  is_active: boolean;
  doctor_count?: number;
}

export interface Chamber {
  id: number;
  building: string;
  name: string;
  room_number: string;
  floor: string;
  description: string;
  address: string;
  contact_number: string;
  department_id: number | null;
  department: Department | null;
  is_active: boolean;
  display_code: string;
  doctors_count?: number;
  doctors?: Array<{
    id: number;
    user_id?: number;
    name: string;
    department_name?: string;
    assigned_days_text: string;
    schedules?: Array<{
      id: number;
      weekday: number;
      weekday_name: string;
      weekday_short: string;
      start_time: string;
      end_time: string;
      start_time_12h: string;
      end_time_12h: string;
    }>;
  }>;
  staff_users?: Array<{
    id: number;
    name: string;
    role: string;
    role_display: string;
  }>;
}

export interface WeeklyAvailability {
  id: number;
  doctor_id: number;
  weekday: number;
  weekday_name: string;
  weekday_short: string;
  start_time: string;
  end_time: string;
  start_time_12h: string;
  end_time_12h: string;
  duration_minutes: number;
  capacity: number;
  active: boolean;
  slot?: AppointmentSlot | null;
  upcoming_date?: string | null;
}

export interface Doctor {
  id: number;
  user_id: number;
  username: string;
  profile_slug: string;
  first_name: string;
  last_name: string;
  name: string;
  full_doctor_title: string;
  title_prefix: string;
  avatar: string | null;
  default_avatar: 'ic-doc-male' | 'ic-doc-female';
  department_id: number | null;
  department: Department | null;
  chamber_id: number | null;
  chamber: Chamber | null;
  chamber_days: string;
  assigned_days_list: number[];
  assigned_days_display: string[];
  assigned_days_text: string;
  gender: 'male' | 'female' | 'other';
  qualifications: string;
  qualifications_list: string[];
  professional_experience: string;
  assigned_receptionist_phone: string;
  designation: string;
  institute: string;
  registration_number: string;
  bmdc_display: string;
  experience_years: number;
  biography: string;
  initial_fee: number;
  followup_fee: number;
  followup_within_days: number;
  report_fee: number;
  report_within_days: number;
  accepted_payment_methods: ('cash' | 'online')[];
  booking_window_hours: number | null;
  max_patients_per_session: number;
  hospital_share_mode: 'percent' | 'fixed' | 'monthly';
  hospital_share_value: number;
  booking_notice_hours: number;
  booking_advance_days: number;
  payment_policy: 'on_day' | 'within';
  payment_deadline_hours: number;
  cancel_fee_mode: 'percent' | 'fixed';
  cancel_fee_value: number;
  room_number: string;
  active_room: string;
  active_address: string;
  active_contact: string;
  assigned_receptionist_id: number | null;
  assigned_receptionist_name: string;
  is_available: boolean;
  weekly: WeeklyAvailability[];
}

export interface AppointmentSlot {
  id: number;
  doctor_id: number;
  template_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  start_time_12h: string;
  end_time_12h: string;
  label: string;
  capacity: number;
  reserved: number;
  remaining: number;
  next_serial_number: number;
  is_full: boolean;
  is_open: boolean;
  booking_open?: boolean;
  doctor?: Doctor;
}

export interface PaymentTransaction {
  id: number;
  appointment_id: number;
  kind: 'charge' | 'refund';
  kind_display: string;
  method: string;
  method_display: string;
  status: string;
  status_display: string;
  amount: number;
  external_id: string | null;
  validation_id: string;
  bank_transaction_id: string;
  refund_reference: string;
  handled_by_name: string;
  note: string;
  processed_at: string | null;
  created_at: string;
}

export interface RefundRequest {
  id: number;
  appointment_id: number;
  amount: number;
  mode: 'cash' | 'online';
  mode_display: string;
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'rejected';
  status_display: string;
  reason: string;
  internal_note: string;
  requested_by_name: string | null;
  reviewed_by_name: string | null;
  created_at: string;
  reviewed_at: string | null;
  completed_at: string | null;
  appointment?: {
    id: number;
    reference: string;
    patient_name: string;
    guest_phone: string;
    fee: number;
    doctor_name: string;
    doctor_title: string;
  };
}

export interface Appointment {
  id: number;
  reference: string;
  serial_number: number;
  slot_id: number;
  patient_id: number | null;
  patient_name: string;
  patient_username: string | null;
  guest_name: string;
  guest_phone: string;
  guest_dob: string | null;
  guest_age: number | null;
  guest_gender: string | null;
  visit_type: 'first' | 'followup' | 'report';
  visit_type_display: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'expired' | 'no_show';
  status_display: string;
  payment_status: 'unpaid' | 'paid' | 'refund_pending' | 'partially_refunded' | 'refunded';
  payment_status_display: string;
  payment_method: 'cash' | 'online';
  accepted_payment_methods: ('cash' | 'online')[];
  payment_method_display: string;
  source: 'web' | 'phone' | 'desk';
  source_display: string;
  fee: number;
  hospital_cut: number;
  doctor_cut: number;
  cancel_mode_snapshot: 'percent' | 'fixed';
  cancel_value_snapshot: number;
  payment_due_at: string | null;
  notes: string;
  cancellation_reason: string;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: string;
  updated_at: string;
  slot: {
    id: number;
    date: string;
    start_time: string;
    end_time: string;
    start_time_12h: string;
    end_time_12h: string;
  };
  doctor: Doctor;
  transactions?: PaymentTransaction[];
  refund_request?: RefundRequest | null;
}

export interface ComplaintMessage {
  id: number;
  message: string;
  author_id: number;
  author_name: string;
  author_role: string;
  created_at: string;
}

export interface Complaint {
  id: number;
  ticket_code: string;
  display_code: string;
  is_support: boolean;
  status_step: number;
  step_label: string;
  subject: string;
  recipient_id: number | null;
  category: string;
  category_display: string;
  message: string;
  attachment: string | null;
  attachment_name: string | null;
  status: 'submitted' | 'reviewing' | 'resolved' | 'approved' | 'rejected';
  status_display: string;
  response: string;
  admin_attachment: string | null;
  admin_attachment_name: string | null;
  patient: {
    id: number;
    username: string;
    name: string;
    first_name: string;
    role: string;
    phone: string;
  };
  updated_by_name: string | null;
  appointment: {
    id: number;
    reference: string;
    date: string;
    doctor_name: string;
    doctor_title: string;
  } | null;
  messages: ComplaintMessage[];
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: number;
  action: string;
  target: string;
  detail: string;
  created_at: string;
  action_label: string;
  action_category: string;
  action_badge_class: string;
  action_icon: string;
  actor_info: {
    name: string;
    role: string;
    initial: string;
    is_system: boolean;
    role_class: string;
  };
  formatted_target: {
    is_appointment: boolean;
    label: string;
    ref: string;
  };
  clean_detail: string;
}
