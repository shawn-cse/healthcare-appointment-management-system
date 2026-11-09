from datetime import datetime, date, time
from decimal import Decimal
from django.db import transaction, models
from django.core.exceptions import ValidationError
from django.utils import timezone

from accounts.models import User, log_audit_event, AuditLog
from bookings.models import Booking
from bookings.services.fee_calculator import calculate_visit_stage_and_fee
from doctors.services.availability import generate_doctor_slots, DHAKA_TZ


def create_appointment(
    doctor: User,
    patient: User,
    appointment_date: date,
    appointment_time: time,
    visit_type: str = "regular",
    payment_method: str = "pay_at_chamber",
    admin_notes: str = "",
    chamber: str = "",
    is_walk_in: bool = False,
    actor: User = None,
) -> Booking:
    """
    Transaction-safe, concurrency-protected appointment booking engine for Green Hospital.
    - Validates doctor approval status (unapproved/suspended doctors cannot accept bookings).
    - Enforces 48-hour booking window server-side.
    - Prevents double booking at the same date and time.
    - Prevents daily/session capacity overflow.
    - Prevents patient overlapping appointments.
    - Deterministically calculates visit stage and locks in the fee snapshot in BDT.
    - Generates daily serial number scoped to doctor and date.
    - Generates unique verifiable appointment reference.
    """
    if not doctor.is_approved_doctor:
        raise ValidationError("This doctor is not currently approved to accept appointments.")

    if not chamber:
        chamber = getattr(doctor.profile, "chamber_number", "")

    # Clean up expired abandoned online checkout sessions before generating slots and reserving
    try:
        from payments.services.payment_service import expire_abandoned_online_sessions
        expire_abandoned_online_sessions()
    except Exception:
        pass

    # Validate slot availability and 48-hour window policy
    slot_info = generate_doctor_slots(
        doctor=doctor,
        target_date=appointment_date,
        allow_past=False,
        is_walk_in=is_walk_in,
    )
    if not slot_info["is_available_date"]:
        raise ValidationError(slot_info.get("reason") or "Doctor is not available on this date.")

    target_slot = None
    for s in slot_info["slots"]:
        if s["time"] == appointment_time:
            target_slot = s
            break

    if not target_slot:
        raise ValidationError(f"No consultation slot found for {appointment_time.strftime('%I:%M %p')}.")

    if not target_slot["is_available"] and not is_walk_in:
        raise ValidationError(target_slot.get("reason") or "Selected time slot is unavailable.")

    # Concurrency-safe reservation block
    with transaction.atomic():
        # Lock active bookings for this doctor & date to prevent race conditions on double booking & serials
        locked_doctor_bookings = list(
            Booking.objects.select_for_update()
            .filter(doctor=doctor, appointment_date=appointment_date)
            .exclude(status=Booking.StatusChoices.CANCELLED)
        )

        # Check if slot was booked in parallel
        for b in locked_doctor_bookings:
            if b.appointment_time == appointment_time:
                raise ValidationError("This time slot was just booked by another patient. Please select another slot.")

        # Check patient overlap: patient cannot have two active appointments at the same date & time
        patient_conflict = (
            Booking.objects.filter(
                patient=patient,
                appointment_date=appointment_date,
                appointment_time=appointment_time,
            )
            .exclude(status=Booking.StatusChoices.CANCELLED)
            .exists()
        )
        if patient_conflict:
            raise ValidationError("You already have an active appointment scheduled at this exact date and time.")

        # Check capacity under lock
        if len(locked_doctor_bookings) >= slot_info["max_capacity"] and slot_info["max_capacity"] > 0:
            raise ValidationError("Doctor's maximum capacity for this date has been reached.")

        # Daily serial number allocation
        existing_serials = [b.serial_number for b in locked_doctor_bookings if b.serial_number]
        next_serial = (max(existing_serials) + 1) if existing_serials else 1

        # Calculate visit stage and locked fee
        pricing = calculate_visit_stage_and_fee(
            patient=patient,
            doctor=doctor,
            visit_type=visit_type,
        )

        booking = Booking(
            doctor=doctor,
            patient=patient,
            appointment_date=appointment_date,
            appointment_time=appointment_time,
            serial_number=next_serial,
            chamber=chamber,
            visit_type=pricing["visit_type"],
            visit_stage=pricing["visit_stage"],
            fee_amount=pricing["fee_amount"],
            payment_method=payment_method,
            payment_status=Booking.PaymentStatus.UNPAID,
            status=(
                Booking.StatusChoices.PENDING
                if payment_method == Booking.PaymentMethod.ONLINE
                else Booking.StatusChoices.CONFIRMED
            ),
            admin_notes=admin_notes,
        )
        booking.save()

        # Audit logging
        log_audit_event(
            actor=actor or patient,
            action=AuditLog.ActionChoices.APPOINTMENT_BOOKED,
            target_user=patient,
            details={
                "booking_id": booking.id,
                "reference": booking.appointment_reference,
                "doctor": doctor.username,
                "serial_number": booking.serial_number,
                "appointment_date": str(booking.appointment_date),
                "appointment_time": str(booking.appointment_time),
                "visit_type": booking.visit_type,
                "visit_stage": booking.visit_stage,
                "fee_amount": str(booking.fee_amount),
                "payment_method": booking.payment_method,
            },
        )

        return booking
