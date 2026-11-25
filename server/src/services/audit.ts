import type { Prisma, PrismaClient, User } from '@prisma/client';
import { prisma } from '../config/db.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export const AUDIT_ACTION_MAP: Record<
  string,
  [label: string, category: string, badgeClass: string, icon: string]
> = {
  'appointment.created': ['Booking Created', 'Booking', 'status-confirmed', 'ic-calendar'],
  'appointment.confirmed': ['Booking Confirmed', 'Booking', 'status-confirmed', 'ic-check'],
  'appointment.completed': ['Consultation Completed', 'Booking', 'status-completed', 'ic-check'],
  'appointment.cancelled': ['Booking Cancelled', 'Booking', 'status-cancelled', 'ic-x'],
  'appointment.expired': ['Booking Expired', 'Booking', 'status-expired', 'ic-clock'],
  'appointment.no_show': ['Marked No-Show', 'Booking', 'status-no_show', 'ic-alert'],
  'appointment.quick_update': ['Quick Desk Update', 'Booking', 'status-info', 'ic-calendar'],
  'appointment.patient_linked': ['Patient Account Linked', 'Booking', 'status-info', 'ic-user'],
  'payment.cash_verified': ['Cash Payment Verified', 'Finance', 'status-confirmed', 'ic-wallet'],
  'payment.gateway_verified': ['Online Payment Confirmed', 'Finance', 'status-confirmed', 'ic-wallet'],
  'payment.gateway_started': ['Online Payment Initiated', 'Finance', 'status-info', 'ic-wallet'],
  'refund.approved': ['Refund Approved', 'Finance', 'status-purple', 'ic-wallet'],
  'refund.rejected': ['Refund Rejected', 'Finance', 'status-cancelled', 'ic-wallet'],
  'refund.cash_disbursed': ['Cash Refund Paid', 'Finance', 'status-purple', 'ic-wallet'],
  'refund.gateway_submitted': ['Gateway Refund Sent', 'Finance', 'status-purple', 'ic-wallet'],
  'refund.gateway_confirmed': ['Gateway Refund Settled', 'Finance', 'status-purple', 'ic-wallet'],
  'patient.registered': ['Patient Registered', 'Account', 'status-info', 'ic-user'],
  'profile.updated': ['Profile Information Updated', 'Account', 'status-info', 'ic-user'],
  'staff.saved': ['Staff Account Saved', 'Account', 'status-info', 'ic-users'],
  'schedule.updated': ['Schedule Updated', 'Schedule', 'status-teal', 'ic-calendar'],
  'schedule.weekly_removed': ['Weekly Slot Removed', 'Schedule', 'status-cancelled', 'ic-calendar'],
  'schedule.copied': ['Schedule Cloned', 'Schedule', 'status-info', 'ic-calendar'],
  'slot.saved': ['Consultation Slot Saved', 'Schedule', 'status-teal', 'ic-calendar'],
  'slot.open_changed': ['Slot Availability Toggled', 'Schedule', 'status-amber', 'ic-calendar'],
  'chamber.saved': ['Chamber Location Updated', 'Management', 'status-info', 'ic-building'],
  'chamber.deleted': ['Chamber Removed', 'Management', 'status-cancelled', 'ic-building'],
  'room.add': ['Consultation Room Added', 'Management', 'status-info', 'ic-building'],
  'room.edit': ['Consultation Room Updated', 'Management', 'status-info', 'ic-building'],
  'room.saved': ['Consultation Room Saved', 'Management', 'status-info', 'ic-building'],
  'room.deleted': ['Consultation Room Deleted', 'Management', 'status-cancelled', 'ic-building'],
  'department.created': ['Department Created', 'Management', 'status-info', 'ic-building'],
  'department.updated': ['Department Updated', 'Management', 'status-info', 'ic-building'],
  'department.activated': ['Department Activated', 'Management', 'status-confirmed', 'ic-building'],
  'department.deactivated': ['Department Deactivated', 'Management', 'status-amber', 'ic-building'],
  'doctor.rules_updated': ['Doctor Practice Rules Saved', 'Management', 'status-teal', 'ic-settings'],
  'hospital.policy_defaults': ['Hospital Policy Updated', 'Management', 'status-teal', 'ic-settings'],
  'complaint.submitted': ['Ticket / Request Logged', 'Support', 'status-amber', 'ic-alert'],
  'complaint.updated': ['Ticket Status Updated', 'Support', 'status-teal', 'ic-alert'],
  'complaint.patient_reply': ['Patient Reply Received', 'Support', 'status-info', 'ic-user'],
  'complaint.inquired': ['Hospital Inquiry Sent', 'Support', 'status-teal', 'ic-help'],
  'complaint.resolved': ['Ticket Issue Solved', 'Support', 'status-confirmed', 'ic-check'],
  'complaint.bulk_submitted': ['Bulk Status: Generated', 'Support', 'status-amber', 'ic-alert'],
  'complaint.bulk_reviewing': ['Bulk Status: Reviewing', 'Support', 'status-teal', 'ic-alert'],
  'complaint.bulk_resolved': ['Bulk Status: Solved', 'Support', 'status-confirmed', 'ic-check'],
  'report.exported': ['Financial Report Exported', 'Analytics', 'status-slate', 'ic-chart'],
};

export async function logAudit(
  actor: Pick<User, 'id'> | null | undefined,
  action: string,
  target: string | number | bigint,
  detail: string | number = '',
  db: DbClient = prisma
): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorId: actor ? actor.id : null,
      action: action.slice(0, 100),
      target: String(target).slice(0, 160),
      detail: String(detail ?? '').slice(0, 2000),
    },
  });
}

export function formatAuditEventMeta(action: string, target: string, detail: string, actor: User | null) {
  const mapped = AUDIT_ACTION_MAP[action];
  const actionLabel =
    mapped?.[0] ||
    action
      .replace(/\./g, ' · ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const actionCategory =
    mapped?.[1] ||
    (action.includes('.')
      ? action.split('.')[0].charAt(0).toUpperCase() + action.split('.')[0].slice(1)
      : 'System');
  const actionBadgeClass = mapped?.[2] || 'status-slate';
  const actionIcon = mapped?.[3] || 'ic-activity';

  let actorInfo: {
    name: string;
    role: string;
    initial: string;
    is_system: boolean;
    role_class: string;
  };
  if (!actor) {
    actorInfo = {
      name: 'System Automation',
      role: 'Automated Task',
      initial: 'SYS',
      is_system: true,
      role_class: 'role-pill-system',
    };
  } else {
    const roleLabelMap: Record<string, string> = {
      admin: 'Admin',
      doctor: 'Doctor',
      receptionist: 'Reception',
      patient: 'Patient',
    };
    const displayName = `${actor.firstName} ${actor.lastName}`.trim() || actor.username;
    const first = (actor.firstName || '').slice(0, 1).toUpperCase();
    const last = (actor.lastName || '').slice(0, 1).toUpperCase();
    const initial = first || last ? `${first}${last}` : actor.username.slice(0, 2).toUpperCase();
    actorInfo = {
      name: displayName,
      role: roleLabelMap[actor.role] || actor.role,
      initial,
      is_system: false,
      role_class: `role-pill-${actor.role}`,
    };
  }

  const cleanTarget = String(target || '').trim();
  const isAppointmentRef = cleanTarget.startsWith('GH-') || /^[A-Z0-9]{6}$/.test(cleanTarget);
  const formattedTarget = isAppointmentRef
    ? { is_appointment: true, label: cleanTarget, ref: cleanTarget }
    : { is_appointment: false, label: cleanTarget || '—', ref: '' };

  let cleanDetail = String(detail || '').trim();
  if (!cleanDetail) {
    cleanDetail = 'Action completed successfully.';
  } else if (cleanDetail.includes('doctor_side=')) {
    const parts = cleanDetail
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    const reasonPart =
      parts.find((p) => p.startsWith('reason='))?.replace('reason=', '').trim() || '';
    const by = cleanDetail.includes('doctor_side=True') || cleanDetail.includes('doctor_side=true')
      ? 'Doctor cancellation'
      : 'Patient cancellation';
    cleanDetail = reasonPart ? `${by} (${reasonPart})` : by;
  } else if (cleanDetail.includes(' BDT')) {
    cleanDetail = cleanDetail.replace(/ BDT/g, ' ৳');
  }

  return {
    action_label: actionLabel,
    action_category: actionCategory,
    action_badge_class: actionBadgeClass,
    action_icon: actionIcon,
    actor_info: actorInfo,
    formatted_target: formattedTarget,
    clean_detail: cleanDetail,
  };
}
