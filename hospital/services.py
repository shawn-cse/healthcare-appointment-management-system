"""Transactional business rules shared by every role and HTTP entry point."""
import uuid
from datetime import datetime, timedelta, date
from decimal import Decimal
from django.conf import settings
from django.core.exceptions import ValidationError, PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import (Appointment, AppointmentSlot, DoctorProfile, WeeklyAvailability,
                     PaymentTransaction, RefundRequest, AuditEvent)

ACTIVE = [Appointment.Status.PENDING, Appointment.Status.CONFIRMED,
          Appointment.Status.COMPLETED, Appointment.Status.NO_SHOW]



def collected_revenue_shares(appointments):
    """Allocate verified net receipts using the fee/share snapshots saved at booking.

    Settled refunds reduce both portions proportionally; outstanding refund approvals
    are not booked as disbursed funds. Amounts are in BDT.
    """
    from django.db.models import Sum
    cash = dict(PaymentTransaction.objects.filter(appointment__in=appointments,
        kind='charge', status='verified').values('appointment_id')
        .annotate(total=Sum('amount')).values_list('appointment_id','total'))
    refunds = dict(PaymentTransaction.objects.filter(appointment__in=appointments,
        kind='refund', status='refunded').values('appointment_id')
        .annotate(total=Sum('amount')).values_list('appointment_id','total'))
    hospital = doctor = Decimal('0.00')
    if cash:
        for pk, fee, hospital_cut in appointments.filter(pk__in=cash).values_list('pk','fee','hospital_cut'):
            retained = max(Decimal('0.00'), cash[pk] - refunds.get(pk, Decimal('0.00')))
            house = min(retained, (retained * hospital_cut / fee).quantize(Decimal('0.01'))) if fee else Decimal('0.00')
            hospital += house
            doctor += retained - house
    return hospital, doctor

def log(actor, action, target, detail=''):
    AuditEvent.objects.create(actor=actor if getattr(actor, 'is_authenticated', False) else None,
                              action=action, target=str(target), detail=str(detail)[:2000])


def doctor_allowed(user, doctor):
    if not user.is_authenticated:
        return False
    if user.role == 'admin':
        return True
    if user.role == 'doctor':
        return doctor.user_id == user.pk
    if user.role == 'receptionist':
        return doctor.receptionists.filter(pk=user.pk).exists()
    return False


def managed_doctors(user):
    qs = DoctorProfile.objects.select_related('user', 'department')
    if user.role == 'doctor':
        return qs.filter(user=user)
    if user.role == 'receptionist':
        return qs.filter(receptionists=user)
    if user.role == 'admin':
        return qs
    return qs.none()


def appointment_allowed(user, appt):
    if user.role == 'patient':
        return appt.patient_id == user.pk
    if user.role == 'admin':
        return True
    return doctor_allowed(user, appt.slot.doctor)


def local_start(slot):
    return timezone.make_aware(datetime.combine(slot.date, slot.start_time), timezone.get_current_timezone())


def materialize_weekly(doctor, days=60):
    """Publish recurring availability; one consultation session per clinic day with full capacity."""
    today = timezone.localdate()
    until = today + timedelta(days=min(days, 180))
    patterns = list(doctor.weekly.filter(active=True))
    if not patterns:
        return 0
    existing = set(AppointmentSlot.objects.filter(
        doctor=doctor, date__range=(today,until)).values_list('date','start_time'))
    pending = []
    session_capacity = getattr(doctor, 'max_patients_per_session', 30) or 30
    for day_n in range((until - today).days + 1):
        day = today + timedelta(days=day_n)
        for pattern in patterns:
            if day.weekday() != pattern.weekday:
                continue
            key = (day, pattern.start_time)
            if key not in existing:
                cap = pattern.capacity if pattern.capacity > 2 else session_capacity
                pending.append(AppointmentSlot(
                    doctor=doctor, date=day,
                    start_time=pattern.start_time, end_time=pattern.end_time,
                    capacity=cap, template=pattern
                ))
                existing.add(key)
    AppointmentSlot.objects.bulk_create(pending, ignore_conflicts=True, batch_size=500)
    return len(pending)


def valid_slot(slot, *, is_staff_booking=False):
    now = timezone.now()
    start = local_start(slot)
    profile = slot.doctor
    if not slot.is_open or not profile.is_available or not profile.user.is_active or start <= now:
        raise ValidationError('This consultation session is no longer open for booking.')
    if not is_staff_booking:
        notice_deadline = now + timedelta(hours=profile.booking_notice_hours)
        if start < notice_deadline:
            hours = profile.booking_notice_hours
            if hours >= 24:
                days = hours // 24
                time_str = f"{days} day{'s' if days > 1 else ''}" if hours % 24 == 0 else f"{hours} hours"
            else:
                time_str = f"{hours} hours"
            raise ValidationError(
                f'Online booking for this session is closed. This doctor requires at least {time_str} advance notice. '
                f'For urgent consultations or today’s serials, please contact the hospital helpline at +88096100016211.'
            )
        if start > now + timedelta(days=profile.booking_advance_days):
            raise ValidationError(f'Appointments can be booked up to {profile.booking_advance_days} days ahead.')


def followup_eligible(doctor, *, patient=None, phone='', appointment_date=None):
    end = appointment_date or timezone.localdate()
    start = end - timedelta(days=doctor.followup_within_days)
    prior = Appointment.objects.filter(slot__doctor=doctor, slot__date__gte=start,
                                       slot__date__lte=end, status=Appointment.Status.COMPLETED)
    if patient:
        prior = prior.filter(Q(patient=patient) | Q(guest_phone=patient.phone))
    else:
        prior = prior.filter(guest_phone=phone)
    return prior.exists()


def fee_for(doctor, visit_type, *, patient=None, phone='', appointment_date=None):
    if visit_type == 'report':
        return doctor.report_fee
    if visit_type == 'followup':
        if not followup_eligible(doctor, patient=patient, phone=phone, appointment_date=appointment_date):
            raise ValidationError('Follow-up rates require a completed visit with this doctor within the eligible period.')
        return doctor.followup_fee
    if visit_type != 'first':
        raise ValidationError('Select a valid consultation type.')
    return doctor.initial_fee


@transaction.atomic
def create_appointment(*, actor, slot_id, patient, name, phone, dob=None, visit_type='first',
                       source='web', payment_method='cash', notes=''):
    slot = AppointmentSlot.objects.select_for_update().select_related('doctor').get(pk=slot_id)
    if actor.role == 'patient':
        if patient != actor or source != 'web':
            raise PermissionDenied('Patients can book only for their own account.')
        name, phone, dob = actor.display_name, actor.phone, actor.dob
    else:
        if not doctor_allowed(actor, slot.doctor):
            raise PermissionDenied('You are not assigned to this doctor.')
    if not name or not phone:
        raise ValidationError('Patient name and phone are required.')
    valid_slot(slot, is_staff_booking=actor.role != 'patient')
    if patient and Appointment.objects.filter(patient=patient,slot__date=slot.date,
            slot__start_time=slot.start_time,status__in=ACTIVE).exists():
        raise ValidationError('You already have an appointment at this time.')
    count = slot.appointments.filter(status__in=ACTIVE).count()
    if count >= slot.capacity:
        raise ValidationError(f'All {slot.capacity} serials for this consultation session have been booked.')
    serial = count + 1
    fee = fee_for(slot.doctor, visit_type, patient=patient, phone=phone, appointment_date=slot.date)
    hospital_cut = slot.doctor.hospital_cut(fee)
    within = slot.doctor.payment_policy == 'within'
    # Payment window ends by session start, whichever comes first.
    due = min(timezone.now() + timedelta(hours=slot.doctor.payment_deadline_hours), local_start(slot)) if within else None
    appointment = Appointment.objects.create(
        slot=slot, serial_number=serial, patient=patient, guest_name=name, guest_phone=phone, guest_dob=dob,
        visit_type=visit_type, status='pending' if within else 'confirmed',
        payment_method=payment_method, source=source, fee=fee, hospital_cut=hospital_cut,
        doctor_cut=fee-hospital_cut, cancel_mode_snapshot=slot.doctor.cancel_fee_mode,
        cancel_value_snapshot=slot.doctor.cancel_fee_value, payment_due_at=due, notes=notes, created_by=actor)
    log(actor, 'appointment.created', appointment.reference, f'{slot.pk} · {fee} BDT · {source}')
    return appointment


@transaction.atomic
def record_cash_payment(appointment, actor, note='Collected at reception'):
    appt = Appointment.objects.select_for_update().select_related('slot__doctor').get(pk=appointment.pk)
    if actor.role not in ('admin', 'receptionist', 'doctor') and not doctor_allowed(actor, appt.slot.doctor):
        raise PermissionDenied('Not authorized to record this payment.')
    if appt.status in ('cancelled','expired'):
        raise ValidationError('Cancelled or expired appointments cannot be paid.')
    if appt.status == 'pending' and appt.payment_due_at and appt.payment_due_at <= timezone.now():
        raise ValidationError('The payment deadline has passed. Please arrange a new booking.')
    if appt.payment_status != 'unpaid':
        raise ValidationError('Payment has already been recorded.')
    appt.payment_status = 'paid'
    appt.payment_method = 'cash'
    if appt.status == 'pending':
        appt.status = 'confirmed'
    appt.save(update_fields=['payment_status','payment_method','status','updated_at'])
    PaymentTransaction.objects.create(appointment=appt, kind='charge', method='cash', status='verified',
                                      amount=appt.fee, handled_by=actor, note=note,
                                      processed_at=timezone.now())
    log(actor, 'payment.cash_verified', appt.reference, note)
    return appt


@transaction.atomic
def cancel_appointment(appointment, actor, *, by_doctor=False, reason=''):
    appt = Appointment.objects.select_for_update().select_related('slot__doctor').get(pk=appointment.pk)
    if appt.status not in ('pending','confirmed'):
        raise ValidationError('Only upcoming active appointments may be cancelled.')
    if local_start(appt.slot) <= timezone.now():
        raise ValidationError('Appointments that have started must be handled by hospital staff.')
    if actor.role == 'patient':
        if appt.patient_id != actor.pk or by_doctor:
            raise PermissionDenied('You cannot cancel this appointment.')
    elif not doctor_allowed(actor, appt.slot.doctor):
        raise PermissionDenied('Not authorized for this appointment.')
    if by_doctor and actor.role not in ('doctor','admin'):
        raise PermissionDenied('Only the doctor or administrator can initiate a doctor-side cancellation.')
    paid = appt.payment_status == 'paid'
    appt.status = 'cancelled'
    appt.cancelled_by = actor
    appt.cancellation_reason = reason
    if paid:
        fee = appt.fee
        if by_doctor:
            refundable = fee
        elif appt.cancel_mode_snapshot == 'fixed':
            refundable = max(Decimal('0.00'), fee-appt.cancel_value_snapshot)
        else:
            penalty = (fee * min(appt.cancel_value_snapshot, Decimal('100')) / 100).quantize(Decimal('0.01'))
            refundable = max(Decimal('0.00'), fee-penalty)
        if refundable > 0:
            appt.payment_status = 'refund_pending'
            RefundRequest.objects.create(appointment=appt, amount=refundable,
                                         mode='online' if appt.payment_method == 'online' else 'cash',
                                         requested_by=actor, reason=reason or ('Doctor cancellation' if by_doctor else 'Patient cancellation'))
    appt.save()
    log(actor, 'appointment.cancelled', appt.reference, f'doctor_side={by_doctor}; reason={reason}')
    return appt


@transaction.atomic
def change_visit_status(appt, actor, new_status):
    appt = Appointment.objects.select_for_update().select_related('slot__doctor').get(pk=appt.pk)
    if not doctor_allowed(actor, appt.slot.doctor):
        raise PermissionDenied('Not authorized.')
    if new_status not in ('completed','no_show') or appt.status != 'confirmed':
        raise ValidationError('Only confirmed appointments can be marked completed or no-show.')
    if local_start(appt.slot) > timezone.now():
        raise ValidationError('Future appointments cannot be marked as attended.')
    if new_status == 'completed' and appt.payment_status != 'paid':
        raise ValidationError('Record payment before completing this appointment.')
    appt.status = new_status
    appt.save(update_fields=['status','updated_at'])
    log(actor, 'appointment.' + new_status, appt.reference)
    return appt


def reconcile_expired():
    now = timezone.now()
    count = 0
    ids = list(Appointment.objects.filter(status='pending', payment_status='unpaid',
                    payment_due_at__lte=now).values_list('pk', flat=True)[:500])
    for pk in ids:
        with transaction.atomic():
            appt = Appointment.objects.select_for_update().get(pk=pk)
            if appt.status == 'pending' and appt.payment_status == 'unpaid' and appt.payment_due_at and appt.payment_due_at <= now:
                appt.status = 'expired'
                appt.save(update_fields=['status','updated_at'])
                log(None, 'appointment.expired', appt.reference)
                count += 1
    return count


def issue_gateway_refund(refund):
    """Returns an external reference only after the gateway accepts the request."""
    from .gateway import gateway_refund
    charge = refund.appointment.payments.filter(kind='charge', method='online', status='verified').first()
    if not charge or not charge.bank_transaction_id:
        raise ValidationError('Verified bank transaction reference is required for an online refund.')
    return gateway_refund(charge.bank_transaction_id, refund.amount, refund.appointment.reference)


@transaction.atomic
def approve_refund(refund_id, actor):
    refund = RefundRequest.objects.select_for_update().select_related('appointment__slot__doctor').get(pk=refund_id)
    if actor.role not in ('admin', 'receptionist') or not doctor_allowed(actor, refund.appointment.slot.doctor):
        raise PermissionDenied('Refund approval is restricted to authorized receptionists and administrators.')
    if refund.status != 'pending':
        raise ValidationError('Only pending requests may be approved.')
    refund.status = 'approved'
    refund.reviewed_by = actor
    refund.reviewed_at = timezone.now()
    refund.save(update_fields=['status','reviewed_by','reviewed_at'])
    log(actor, 'refund.approved', refund.appointment.reference, refund.amount)
    # Online refund is intentionally initiated by separate action to avoid side effects
    # inside database transaction and allow operators to review gateway errors.
    return refund


@transaction.atomic
def finalize_cash_refund(refund_id, actor):
    refund = RefundRequest.objects.select_for_update().select_related('appointment__slot__doctor').get(pk=refund_id)
    if actor.role not in ('admin','receptionist') or not doctor_allowed(actor, refund.appointment.slot.doctor):
        raise PermissionDenied('Not authorized.')
    if refund.mode != 'cash' or refund.status != 'approved':
        raise ValidationError('Only approved cash refunds can be marked paid out.')
    refund.status = 'completed'
    refund.completed_at = timezone.now()
    refund.save(update_fields=['status','completed_at'])
    appt = refund.appointment
    appt.payment_status = 'refunded' if refund.amount >= appt.fee else 'partially_refunded'
    appt.save(update_fields=['payment_status','updated_at'])
    PaymentTransaction.objects.create(appointment=appt, kind='refund', method='cash',
                                      status='refunded', amount=refund.amount, handled_by=actor,
                                      processed_at=timezone.now())
    log(actor, 'refund.cash_disbursed', appt.reference, refund.amount)
    return refund
