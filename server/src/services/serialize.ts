import type {
  Appointment,
  AppointmentSlot,
  AuditEvent,
  Chamber,
  Complaint,
  ComplaintMessage,
  Department,
  DoctorProfile,
  PaymentTransaction,
  RefundRequest,
  User,
  WeeklyAvailability,
} from '@prisma/client';
import { dateToIso, localTodayDate, timeTo12h, timeToHm, WEEKDAY_NAMES, WEEKDAY_SHORT } from '../utils/dateTime.js';
import { mediaUrl } from '../utils/upload.js';
import { formatAuditEventMeta } from './audit.js';

const ROLE_DISPLAY: Record<string, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  admin: 'Administrator',
};

const VISIT_DISPLAY: Record<string, string> = {
  first: 'First Visit / New Patient',
  followup: 'Second Visit / Follow-up',
  report: 'Report Review',
};

const STATUS_DISPLAY: Record<string, string> = {
  pending: 'Awaiting payment',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Payment deadline passed',
  no_show: 'Did not attend',
};

const PAYMENT_STATUS_DISPLAY: Record<string, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  refund_pending: 'Refund pending',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
};

const PAYMENT_METHOD_DISPLAY: Record<string, string> = {
  cash: 'Cash / at reception',
  online: 'Online',
};

const SOURCE_DISPLAY: Record<string, string> = {
  web: 'Patient portal',
  phone: 'Telephone',
  desk: 'Reception desk',
};

const TX_KIND_DISPLAY: Record<string, string> = {
  charge: 'Charge',
  refund: 'Refund',
};

const TX_METHOD_DISPLAY: Record<string, string> = {
  cash: 'Cash',
  online: 'SSLCOMMERZ',
  bank: 'Bank transfer',
};

const TX_STATUS_DISPLAY: Record<string, string> = {
  initiated: 'Initiated',
  verified: 'Verified',
  failed: 'Failed',
  processing: 'Processing',
  refunded: 'Refunded',
};

const REFUND_MODE_DISPLAY: Record<string, string> = {
  cash: 'Cash',
  online: 'Online gateway',
};

const REFUND_STATUS_DISPLAY: Record<string, string> = {
  pending: 'Pending approval',
  approved: 'Approved',
  processing: 'Processing',
  completed: 'Completed',
  rejected: 'Rejected',
};

const COMPLAINT_CATEGORY_DISPLAY: Record<string, string> = {
  support: 'General Support & Help',
  doctor: 'Doctor & Consultation',
  hospital: 'Hospital Facilities',
  staff: 'Staff & Reception',
  billing: 'Billing & Payment',
  other: 'Other Issue',
  cancel_appointment: 'Cancel Appointment',
  reschedule: 'Adjust Date & Time',
  adjust_visit: 'Adjust Consultation Fee or Visit Type',
  payment_issue: 'Payment Issue',
  refund_request: 'Refund Request',
  other_issue: 'Other Issue',
  assistance: 'Assistance Request',
  internal_complaint: 'Internal Complaint',
  admin_request: 'Administrative Request',
  technical: 'Technical Issue',
  important_message: 'Important Message',
};

const COMPLAINT_STATUS_DISPLAY: Record<string, string> = {
  submitted: 'Complaint Generated',
  reviewing: 'Under Review & Inquiring',
  resolved: 'Issue Solved',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function userDisplayName(u: Pick<User, 'firstName' | 'lastName' | 'username'>): string {
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
  return full || u.username;
}

export function serializeUser(u: User & { chamber?: Chamber | null }) {
  const today = dateToIso(localTodayDate());
  const birth = u.dob ? dateToIso(u.dob) : null;
  const age = birth ? Math.max(0, Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - Number(today.slice(5) < birth.slice(5))) : null;
  return {
    id: Number(u.id),
    username: u.username,
    email: u.email,
    role: u.role,
    role_display: ROLE_DISPLAY[u.role] || u.role,
    first_name: u.firstName,
    last_name: u.lastName,
    display_name: userDisplayName(u),
    phone: u.phone || '',
    dob: birth,
    age,
    nid: u.nid,
    address: u.address,
    avatar: mediaUrl(u.avatar),
    chamber_id: u.chamberId ? Number(u.chamberId) : null,
    room_number: u.chamber?.roomNumber || '',
    is_active: u.isActive,
    login_allowed: u.loginAllowed,
    phone_verified: Boolean(u.phoneVerifiedAt),
    gender: u.gender || '',
    is_staff: u.isStaff,
    is_superuser: u.isSuperuser,
    date_joined: u.dateJoined.toISOString(),
    created_at: u.createdAt.toISOString(),
  };
}

export function serializeDepartment(d: Department & { docCount?: number }) {
  return {
    id: Number(d.id),
    name: d.name,
    slug: d.slug,
    description: d.description,
    icon: d.icon,
    is_active: d.isActive,
    ...(typeof d.docCount === 'number' ? { doctor_count: d.docCount } : {}),
  };
}

export function serializeChamber(
  c: Chamber & {
    department?: Department | null;
    doctors?: Array<DoctorProfile & { user: User; department?: Department | null; weekly?: WeeklyAvailability[] }>;
    staffUsers?: User[];
  }
) {
  return {
    id: Number(c.id),
    building: c.building,
    name: c.name,
    room_number: c.roomNumber,
    floor: c.floor,
    description: c.description,
    address: c.address,
    contact_number: c.contactNumber,
    department_id: c.departmentId ? Number(c.departmentId) : null,
    department: c.department ? serializeDepartment(c.department) : null,
    is_active: c.isActive,
    display_code: c.building && c.roomNumber ? `${c.building}, ${c.roomNumber}` : c.roomNumber,
    created_at: c.createdAt.toISOString(),
    ...(c.doctors
      ? {
          doctors_count: c.doctors.filter((d) => d.user?.isActive).length,
          doctors: c.doctors
            .filter((d) => d.user?.isActive)
            .map((d) => ({
              id: Number(d.id),
              user_id: Number(d.userId),
              name: userDisplayName(d.user),
              department_name: d.department?.name || 'General Consultation',
              assigned_days_text: computeAssignedDaysText(d.weekly || [], d.chamberDays),
              schedules: (d.weekly || [])
                .filter((w) => w.active)
                .sort(
                  (a, b) =>
                    a.weekday - b.weekday ||
                    timeToHm(a.startTime).localeCompare(timeToHm(b.startTime))
                )
                .map((w) => ({
                  id: Number(w.id),
                  weekday: w.weekday,
                  weekday_name: WEEKDAY_NAMES[w.weekday] || String(w.weekday),
                  weekday_short: WEEKDAY_SHORT[w.weekday] || String(w.weekday),
                  start_time: timeToHm(w.startTime),
                  end_time: timeToHm(w.endTime),
                  start_time_12h: timeTo12h(w.startTime),
                  end_time_12h: timeTo12h(w.endTime),
                })),
            })),
        }
      : {}),
    ...(c.staffUsers
      ? {
          staff_users: c.staffUsers
            .filter((u) => u.isActive && u.role !== 'doctor')
            .map((u) => ({
              id: Number(u.id),
              name: userDisplayName(u),
              role: u.role,
              role_display: ROLE_DISPLAY[u.role] || u.role,
            })),
        }
      : {}),
  };
}

function computeAssignedDaysList(weekly: WeeklyAvailability[], chamberDays: string): number[] {
  const fromWeekly = Array.from(
    new Set(weekly.filter((w) => w.active).map((w) => w.weekday))
  ).sort((a, b) => a - b);
  if (fromWeekly.length > 0) return fromWeekly;
  if (chamberDays) {
    return chamberDays
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^\d+$/.test(x))
      .map(Number)
      .filter((n) => n >= 0 && n <= 6);
  }
  return [];
}

function computeAssignedDaysText(weekly: WeeklyAvailability[], chamberDays: string): string {
  const days = computeAssignedDaysList(weekly, chamberDays).map((d) => WEEKDAY_SHORT[d]);
  return days.length ? days.join(', ') : 'Unscheduled';
}

export type DoctorWithRelations = DoctorProfile & {
  user: User;
  department?: Department | null;
  chamber?: Chamber | null;
  weekly?: WeeklyAvailability[];
  receptionists?: Array<{ user: User }>;
};

export function serializeDoctor(d: DoctorWithRelations) {
  const prefix = (d.titlePrefix || '').trim() || 'Dr.';
  const displayName = userDisplayName(d.user);
  const fullTitle = `${prefix} ${displayName}`;
  const reg = (d.registrationNumber || '').trim();
  const bmdcDisplay = reg
    ? reg.toUpperCase().startsWith('BMDC')
      ? reg
      : `BMDC Reg: ${reg}`
    : '';

  const qualificationsList = (d.qualifications || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const activeRecep = d.receptionists?.find((r) => r.user.isActive)?.user;
  const activeRoom = d.chamber?.roomNumber || d.roomNumber || '';
  const activeAddress = d.chamber?.address || d.chamberAddress || 'Mirpur, Dhaka';
  const activeContact = d.chamber?.contactNumber || d.contactNumber || '+88096100016211';
  const weekly = d.weekly || [];
  const assignedDaysList = computeAssignedDaysList(weekly, d.chamberDays);
  const assignedDaysDisplay = assignedDaysList.map((idx) => WEEKDAY_SHORT[idx]).filter(Boolean);

  return {
    id: Number(d.id),
    user_id: Number(d.userId),
    username: d.user.username,
    profile_slug: d.user.username || String(d.id),
    first_name: d.user.firstName,
    last_name: d.user.lastName,
    name: displayName,
    full_doctor_title: fullTitle,
    title_prefix: d.titlePrefix,
    avatar: mediaUrl(d.user.avatar),
    default_avatar: d.gender === 'female' ? 'ic-doc-female' : 'ic-doc-male',
    department_id: d.departmentId ? Number(d.departmentId) : null,
    department: d.department ? serializeDepartment(d.department) : null,
    chamber_id: d.chamberId ? Number(d.chamberId) : null,
    chamber: d.chamber ? serializeChamber(d.chamber) : null,
    chamber_days: d.chamberDays,
    assigned_days_list: assignedDaysList,
    assigned_days_display: assignedDaysDisplay,
    assigned_days_text: assignedDaysDisplay.length ? assignedDaysDisplay.join(', ') : 'Unscheduled',
    gender: d.gender,
    qualifications: d.qualifications,
    qualifications_list: qualificationsList,
    professional_experience: d.professionalExperience,
    designation: d.designation,
    institute: d.institute,
    registration_number: d.registrationNumber,
    bmdc_display: bmdcDisplay,
    experience_years: d.experienceYears,
    biography: d.biography,
    initial_fee: Number(d.initialFee),
    followup_fee: Number(d.followupFee),
    followup_within_days: d.followupWithinDays,
    report_fee: Number(d.reportFee),
    report_within_days: d.reportWithinDays,
    accepted_payment_methods: d.acceptedPaymentMethods.split(','),
    booking_window_hours: d.bookingWindowHours,
    max_patients_per_session: d.maxPatientsPerSession,
    hospital_share_mode: d.hospitalShareMode,
    hospital_share_value: Number(d.hospitalShareValue),
    booking_notice_hours: d.bookingNoticeHours,
    booking_advance_days: d.bookingAdvanceDays,
    payment_policy: d.paymentPolicy,
    payment_deadline_hours: d.paymentDeadlineHours,
    cancel_fee_mode: d.cancelFeeMode,
    cancel_fee_value: Number(d.cancelFeeValue),
    room_number: d.roomNumber,
    active_room: activeRoom,
    active_address: activeAddress,
    active_contact: activeContact,
    assigned_receptionist_id: activeRecep ? Number(activeRecep.id) : null,
    assigned_receptionist_name: activeRecep ? userDisplayName(activeRecep) : 'Front Desk Reception',
    assigned_receptionist_phone: activeRecep?.phone || '',
    is_available: d.isAvailable,
    weekly: weekly
      .filter((w) => w.active)
      .sort((a, b) => a.weekday - b.weekday || timeToHm(a.startTime).localeCompare(timeToHm(b.startTime)))
      .map(serializeWeekly),
  };
}

export function serializePublicDoctor(d: DoctorWithRelations) {
  const { hospital_share_mode, hospital_share_value, biography, experience_years, max_patients_per_session, ...profile } = serializeDoctor(d);
  return { ...profile, active_room: d.chamber?.roomNumber || '', room_number: d.chamber?.roomNumber || '' };
}

export function serializeWeekly(w: WeeklyAvailability) {
  return {
    id: Number(w.id),
    doctor_id: Number(w.doctorId),
    weekday: w.weekday,
    weekday_name: WEEKDAY_NAMES[w.weekday] || String(w.weekday),
    weekday_short: WEEKDAY_SHORT[w.weekday] || String(w.weekday),
    start_time: timeToHm(w.startTime),
    end_time: timeToHm(w.endTime),
    start_time_12h: timeTo12h(w.startTime),
    end_time_12h: timeTo12h(w.endTime),
    duration_minutes: w.durationMinutes,
    capacity: w.capacity,
    active: w.active,
  };
}

export function serializeSlot(
  s: AppointmentSlot & { doctor?: DoctorWithRelations },
  reservedCount = 0,
  bookingOpen?: boolean
) {
  const remaining = Math.max(0, s.capacity - reservedCount);
  return {
    id: Number(s.id),
    doctor_id: Number(s.doctorId),
    template_id: s.templateId ? Number(s.templateId) : null,
    date: dateToIso(s.date),
    start_time: timeToHm(s.startTime),
    end_time: timeToHm(s.endTime),
    start_time_12h: timeTo12h(s.startTime),
    end_time_12h: timeTo12h(s.endTime),
    label: `${timeTo12h(s.startTime)} – ${timeTo12h(s.endTime)}`,
    capacity: s.capacity,
    reserved: reservedCount,
    remaining,
    next_serial_number: reservedCount + 1,
    is_full: remaining <= 0,
    is_open: s.isOpen,
    ...(typeof bookingOpen === 'boolean' ? { booking_open: bookingOpen } : {}),
    ...(s.doctor ? { doctor: serializeDoctor(s.doctor) } : {}),
  };
}

export function serializePaymentTransaction(
  t: PaymentTransaction & { handledBy?: User | null }
) {
  return {
    id: Number(t.id),
    appointment_id: Number(t.appointmentId),
    kind: t.kind,
    kind_display: TX_KIND_DISPLAY[t.kind] || t.kind,
    method: t.method,
    method_display: TX_METHOD_DISPLAY[t.method] || t.method,
    status: t.status,
    status_display: TX_STATUS_DISPLAY[t.status] || t.status,
    amount: Number(t.amount),
    external_id: t.externalId,
    validation_id: t.validationId,
    bank_transaction_id: t.bankTransactionId,
    refund_reference: t.refundReference,
    handled_by_name: t.handledBy ? userDisplayName(t.handledBy) : 'System Gateway',
    note: t.note,
    processed_at: t.processedAt ? t.processedAt.toISOString() : null,
    created_at: t.createdAt.toISOString(),
  };
}

export function serializeRefundRequest(
  r: RefundRequest & {
    appointment?: Appointment & {
      patient?: User | null;
      slot: AppointmentSlot & { doctor: DoctorWithRelations };
    };
    requestedBy?: User | null;
    reviewedBy?: User | null;
  }
) {
  return {
    id: Number(r.id),
    appointment_id: Number(r.appointmentId),
    amount: Number(r.amount),
    mode: r.mode,
    mode_display: REFUND_MODE_DISPLAY[r.mode] || r.mode,
    status: r.status,
    status_display: REFUND_STATUS_DISPLAY[r.status] || r.status,
    reason: r.reason,
    internal_note: r.internalNote,
    requested_by_name: r.requestedBy ? userDisplayName(r.requestedBy) : null,
    reviewed_by_name: r.reviewedBy ? userDisplayName(r.reviewedBy) : null,
    created_at: r.createdAt.toISOString(),
    reviewed_at: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    completed_at: r.completedAt ? r.completedAt.toISOString() : null,
    ...(r.appointment
      ? {
          appointment: {
            id: Number(r.appointment.id),
            reference: r.appointment.reference,
            patient_name: r.appointment.patient
              ? userDisplayName(r.appointment.patient)
              : r.appointment.guestName,
            guest_phone: r.appointment.guestPhone,
            fee: Number(r.appointment.fee),
            doctor_name: r.appointment.slot.doctor
              ? userDisplayName(r.appointment.slot.doctor.user)
              : '',
            doctor_title: r.appointment.slot.doctor
              ? `${r.appointment.slot.doctor.titlePrefix || 'Dr.'} ${userDisplayName(r.appointment.slot.doctor.user)}`
              : '',
          },
        }
      : {}),
  };
}

export type AppointmentWithRelations = Appointment & {
  slot: AppointmentSlot & { doctor: DoctorWithRelations };
  patient?: User | null;
  createdBy?: User | null;
  cancelledBy?: User | null;
  payments?: Array<PaymentTransaction & { handledBy?: User | null }>;
  refund?: RefundRequest | null;
};

export function serializeAppointment(a: AppointmentWithRelations) {
  const doc = a.slot.doctor;
  const patientName = a.patient ? userDisplayName(a.patient) : a.guestName;
  return {
    id: Number(a.id),
    reference: a.reference,
    serial_number: a.serialNumber,
    slot_id: Number(a.slotId),
    patient_id: a.patientId ? Number(a.patientId) : null,
    patient_name: patientName,
    patient_username: a.patient?.username || null,
    guest_name: a.guestName,
    guest_phone: a.guestPhone,
    guest_dob: a.guestDob ? dateToIso(a.guestDob) : null,
    visit_type: a.visitType,
    visit_type_display: VISIT_DISPLAY[a.visitType] || a.visitType,
    status: a.status,
    status_display: STATUS_DISPLAY[a.status] || a.status,
    payment_status: a.paymentStatus,
    payment_status_display: PAYMENT_STATUS_DISPLAY[a.paymentStatus] || a.paymentStatus,
    payment_method: a.paymentMethod,
    accepted_payment_methods: a.acceptedPaymentMethods.split(','),
    guest_age: a.guestAge,
    guest_gender: a.guestGender,
    payment_method_display: PAYMENT_METHOD_DISPLAY[a.paymentMethod] || a.paymentMethod,
    source: a.source,
    source_display: SOURCE_DISPLAY[a.source] || a.source,
    fee: Number(a.fee),
    hospital_cut: Number(a.hospitalCut),
    doctor_cut: Number(a.doctorCut),
    cancel_mode_snapshot: a.cancelModeSnapshot,
    cancel_value_snapshot: Number(a.cancelValueSnapshot),
    payment_due_at: a.paymentDueAt ? a.paymentDueAt.toISOString() : null,
    notes: a.notes,
    cancellation_reason: a.cancellationReason,
    created_by_name: a.createdBy ? userDisplayName(a.createdBy) : null,
    created_by_role: a.createdBy ? ROLE_DISPLAY[a.createdBy.role] || a.createdBy.role : null,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
    slot: {
      id: Number(a.slot.id),
      date: dateToIso(a.slot.date),
      start_time: timeToHm(a.slot.startTime),
      end_time: timeToHm(a.slot.endTime),
      start_time_12h: timeTo12h(a.slot.startTime),
      end_time_12h: timeTo12h(a.slot.endTime),
    },
    doctor: serializeDoctor(doc),
    ...(a.payments ? { transactions: a.payments.map(serializePaymentTransaction) } : {}),
    ...(a.refund !== undefined
      ? { refund_request: a.refund ? serializeRefundRequest(a.refund) : null }
      : {}),
  };
}

export function serializeComplaint(
  c: Complaint & {
    patient: User;
    appointment?: (Appointment & { slot: AppointmentSlot & { doctor: DoctorWithRelations } }) | null;
    updatedBy?: User | null;
    messages?: Array<ComplaintMessage & { author: User }>;
  }
) {
  const displayCode = c.ticketCode
    ? c.ticketCode.replace(/TK-/g, '').replace(/-/g, '').toUpperCase()
    : String(c.id).padStart(6, '0');
  const isSupport = c.category === 'support';
  const statusStep = c.status === 'resolved' ? 3 : c.status === 'reviewing' ? 2 : 1;
  let stepLabel = COMPLAINT_STATUS_DISPLAY[c.status] || c.status;
  if (c.status === 'submitted') {
    stepLabel = isSupport ? 'Support Help Generated' : 'Complaint Generated';
  }

  return {
    id: Number(c.id),
    ticket_code: c.ticketCode,
    display_code: displayCode,
    is_support: isSupport,
    status_step: statusStep,
    step_label: stepLabel,
    subject: c.subject,
    recipient_id: c.recipientId ? Number(c.recipientId) : null,
    category: c.category,
    category_display: COMPLAINT_CATEGORY_DISPLAY[c.category] || c.category,
    message: c.message,
    attachment: c.attachment ? `/complaints/${c.id}/attachments/original` : null,
    attachment_name: c.attachment ? c.attachment.split('/').pop() || c.attachment : null,
    status: c.status,
    status_display: COMPLAINT_STATUS_DISPLAY[c.status] || c.status,
    response: c.response,
    admin_attachment: c.adminAttachment ? `/complaints/${c.id}/attachments/response` : null,
    admin_attachment_name: c.adminAttachment
      ? c.adminAttachment.split('/').pop() || c.adminAttachment
      : null,
    patient: {
      id: Number(c.patient.id),
      username: c.patient.username,
      name: userDisplayName(c.patient),
      first_name: c.patient.firstName,
      role: c.patient.role,
      phone: c.patient.phone || '',
    },
    updated_by_name: c.updatedBy ? userDisplayName(c.updatedBy) : null,
    appointment: c.appointment
      ? {
          id: Number(c.appointment.id),
          reference: c.appointment.reference,
          date: dateToIso(c.appointment.slot.date),
          doctor_name: userDisplayName(c.appointment.slot.doctor.user),
          doctor_title: `${c.appointment.slot.doctor.titlePrefix || 'Dr.'} ${userDisplayName(c.appointment.slot.doctor.user)}`,
        }
      : null,
    messages: (c.messages || []).map((m) => ({
      id: Number(m.id),
      message: m.message,
      author_id: Number(m.authorId),
      author_name: userDisplayName(m.author),
      author_role: m.author.role,
      created_at: m.createdAt.toISOString(),
    })),
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function serializeAuditEvent(e: AuditEvent & { actor: User | null }) {
  const meta = formatAuditEventMeta(e.action, e.target, e.detail, e.actor);
  return {
    id: Number(e.id),
    action: e.action,
    target: e.target,
    detail: e.detail,
    created_at: e.createdAt.toISOString(),
    ...meta,
  };
}
