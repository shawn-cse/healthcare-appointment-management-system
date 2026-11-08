from datetime import datetime, date, time, timedelta
import zoneinfo
from django.utils import timezone
from django.db.models import Q

from accounts.models import User
from bookings.models import Booking
from doctors.models.schedules import (
    DoctorWeeklySchedule,
    DoctorScheduleBreak,
    DoctorAvailabilityException,
    HospitalSetting,
)

DHAKA_TZ = zoneinfo.ZoneInfo("Asia/Dhaka")


def get_dhaka_now() -> datetime:
    """Returns current datetime in Asia/Dhaka timezone."""
    return timezone.now().astimezone(DHAKA_TZ)


def check_schedule_overlap(doctor, weekday, start_time, end_time, exclude_id=None) -> bool:
    """
    Checks if a proposed schedule session overlaps with an existing session
    for the same doctor on the same weekday.
    """
    qs = DoctorWeeklySchedule.objects.filter(
        doctor=doctor,
        weekday=weekday,
        is_active=True,
    )
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)

    for s in qs:
        # Two intervals [start_time, end_time) and [s.start_time, s.end_time) overlap if:
        # max(start_time, s.start_time) < min(end_time, s.end_time)
        overlap_start = max(start_time, s.start_time)
        overlap_end = min(end_time, s.end_time)
        if overlap_start < overlap_end:
            return True
    return False


def detect_chamber_conflicts(doctor, weekday, start_time, end_time, chamber_room, exclude_schedule_id=None):
    """
    Detects if another doctor has a scheduled session in the same chamber room at an overlapping time on the same weekday.
    """
    if not chamber_room:
        return []
    qs = DoctorWeeklySchedule.objects.filter(
        weekday=weekday,
        chamber_number__iexact=chamber_room.strip(),
        is_active=True,
    ).exclude(doctor=doctor)
    if exclude_schedule_id:
        qs = qs.exclude(pk=exclude_schedule_id)

    conflicts = []
    for s in qs:
        overlap_start = max(start_time, s.start_time)
        overlap_end = min(end_time, s.end_time)
        if overlap_start < overlap_end:
            conflicts.append({
                "schedule": s,
                "doctor": s.doctor,
                "doctor_name": s.doctor.get_full_name(),
                "chamber": s.chamber_number,
                "start_time": s.start_time,
                "end_time": s.end_time,
            })
    return conflicts


def detect_affected_appointments(doctor, target_date, start_time=None, end_time=None):
    """
    Identifies any existing confirmed/checked-in/pending appointments that would be
    affected by an availability change or date exception, ensuring they are NEVER
    silently cancelled and can be explicitly rescheduled or managed.
    """
    qs = Booking.objects.filter(
        doctor=doctor,
        appointment_date=target_date,
        status__in=[
            Booking.StatusChoices.PENDING,
            Booking.StatusChoices.CONFIRMED,
            Booking.StatusChoices.CHECKED_IN,
        ],
    )
    if start_time and end_time:
        qs = qs.filter(appointment_time__gte=start_time, appointment_time__lt=end_time)
    return list(qs)


def generate_doctor_slots(doctor, target_date: date, allow_past=False, is_walk_in=False) -> dict:
    """
    Generates appointment slots for a doctor on a given target date according to Green Hospital rules:
    - Asia/Dhaka timezone.
    - Excludes unapproved/suspended doctors.
    - Excludes dates marked as not available, holidays, leaves.
    - Excludes breaks and blocked intervals.
    - Excludes past slots (unless explicit allow_past).
    - Enforces 48-hour booking window: appointment_start - 48h <= now < appointment_start.
    - Excludes slots if daily or session max patient capacity is full.
    - Displays booked and remaining patient capacity.
    - Detects chamber room conflicts.
    - Supports fallback to legacy time_range for existing fixture doctors.
    """
    result = {
        "doctor": doctor,
        "date": target_date,
        "slots": [],
        "max_capacity": 0,
        "booked_count": 0,
        "remaining_capacity": 0,
        "is_full": False,
        "is_available_date": True,
        "reason": None,
    }

    # 1. Unapproved or non-active doctors cannot accept appointments
    if not doctor.is_approved_doctor:
        result["is_available_date"] = False
        result["reason"] = "Doctor is not approved or account is inactive."
        return result

    now_dhaka = get_dhaka_now()
    target_dt_start = timezone.make_aware(datetime.combine(target_date, time(0, 0)), DHAKA_TZ)

    # 2. Check Doctor Availability Exceptions (Day Off, Holiday, Leave)
    active_exceptions = DoctorAvailabilityException.objects.filter(
        doctor=doctor,
        is_active=True,
        start_date__lte=target_date,
        end_date__gte=target_date,
    )

    whole_day_exceptions = active_exceptions.filter(
        exception_type__in=[
            DoctorAvailabilityException.ExceptionType.DAY_OFF,
            DoctorAvailabilityException.ExceptionType.HOLIDAY,
            DoctorAvailabilityException.ExceptionType.DAY_OFF,
            DoctorAvailabilityException.ExceptionType.BLOCKED_SESSION,
        ],
        start_time__isnull=True,
    )
    if whole_day_exceptions.exists():
        exc = whole_day_exceptions.first()
        result["is_available_date"] = False
        result["reason"] = exc.reason or exc.get_exception_type_display()
        return result

    # 3. Retrieve weekly recurring schedules for target_date's weekday
    # Weekday in Python: 0=Monday, 6=Sunday
    weekday = target_date.weekday()
    schedules = list(
        DoctorWeeklySchedule.objects.filter(
            doctor=doctor,
            weekday=weekday,
            is_active=True,
        ).prefetch_related("breaks").order_by("start_time")
    )

    # Fallback to legacy models (Saturday..Friday) if no weekly schedules configured yet
    use_legacy = False
    if not schedules:
        day_name = target_date.strftime("%A").lower()
        legacy_day = getattr(doctor, day_name, None)
        if legacy_day and legacy_day.time_range.exists():
            use_legacy = True

    if not schedules and not use_legacy:
        result["is_available_date"] = False
        result["reason"] = "Doctor has no schedule on this day."
        return result

    # 4. Count existing active bookings for doctor on this date
    existing_bookings = Booking.objects.filter(
        doctor=doctor,
        appointment_date=target_date,
    ).exclude(status=Booking.StatusChoices.CANCELLED)

    booked_times = set(existing_bookings.values_list("appointment_time", flat=True))
    total_booked_count = existing_bookings.count()
    result["booked_count"] = total_booked_count

    # 5. Booking Window Policy (default 48 hours)
    booking_window_hours = HospitalSetting.get_booking_window_hours()

    generated_slots = []
    total_max_capacity = 0

    if not use_legacy:
        for sched in schedules:
            total_max_capacity += sched.max_capacity
            breaks = list(sched.breaks.all())
            slot_duration = sched.slot_duration or 15

            # Count booked in this session
            session_booked_count = existing_bookings.filter(
                appointment_time__gte=sched.start_time,
                appointment_time__lt=sched.end_time,
            ).count()

            # Generate slots
            current_dt = datetime.combine(target_date, sched.start_time)
            session_end_dt = datetime.combine(target_date, sched.end_time)

            while current_dt < session_end_dt:
                slot_time = current_dt.time()
                slot_aware_dt = timezone.make_aware(current_dt, DHAKA_TZ)

                # Check breaks
                in_break = any(
                    b.start_time <= slot_time < b.end_time for b in breaks
                )
                # Check blocked interval exceptions
                in_blocked = active_exceptions.filter(
                    exception_type=DoctorAvailabilityException.ExceptionType.BLOCKED_INTERVAL,
                    start_time__lte=slot_time,
                    end_time__gt=slot_time,
                ).exists()

                if not in_break and not in_blocked:
                    is_past = slot_aware_dt <= now_dhaka
                    # 48-hour booking window check:
                    # slot must be within 48 hours from now: slot_aware_dt - 48h <= now_dhaka < slot_aware_dt
                    outside_window = (
                        slot_aware_dt - timedelta(hours=booking_window_hours) > now_dhaka
                    )

                    is_booked = slot_time in booked_times
                    chamber_num = sched.chamber_number or getattr(doctor.profile, "chamber_number", "")

                    # Shared chamber collision check
                    chamber_conflict = False
                    if chamber_num:
                        chamber_conflict = Booking.objects.filter(
                            appointment_date=target_date,
                            appointment_time=slot_time,
                            chamber=chamber_num,
                        ).exclude(doctor=doctor).exclude(status=Booking.StatusChoices.CANCELLED).exists()

                    capacity_exceeded = (
                        session_booked_count >= sched.max_capacity
                        or total_booked_count >= total_max_capacity
                    )

                    slot_available = True
                    unavailability_reason = None

                    if is_booked:
                        slot_available = False
                        unavailability_reason = "Already Booked"
                    elif is_past and not allow_past:
                        slot_available = False
                        unavailability_reason = "Past Slot"
                    elif outside_window and not is_walk_in:
                        slot_available = False
                        unavailability_reason = f"Booking opens {booking_window_hours}h before appointment"
                    elif capacity_exceeded:
                        slot_available = False
                        unavailability_reason = "Session Capacity Full"
                    elif chamber_conflict:
                        slot_available = False
                        unavailability_reason = "Chamber Occupied"

                    generated_slots.append(
                        {
                            "time": slot_time,
                            "time_str": slot_time.strftime("%H:%M"),
                            "formatted_time": slot_time.strftime("%I:%M %p"),
                            "session_name": sched.session_name,
                            "chamber": chamber_num,
                            "is_available": slot_available,
                            "is_booked": is_booked,
                            "reason": unavailability_reason,
                            "slot_datetime": slot_aware_dt,
                        }
                    )

                current_dt += timedelta(minutes=slot_duration)
    else:
        # Legacy time_range fallback
        day_name = target_date.strftime("%A").lower()
        legacy_day = getattr(doctor, day_name)
        total_max_capacity = 25
        for tr in legacy_day.time_range.filter(is_active=True):
            slot_duration = tr.get_slot_duration()
            current_dt = datetime.combine(target_date, tr.start)
            end_dt = datetime.combine(target_date, tr.end)

            while current_dt < end_dt:
                slot_time = current_dt.time()
                slot_aware_dt = timezone.make_aware(current_dt, DHAKA_TZ)
                is_booked = slot_time in booked_times
                is_past = slot_aware_dt <= now_dhaka
                outside_window = (
                    slot_aware_dt - timedelta(hours=booking_window_hours) > now_dhaka
                )
                capacity_exceeded = total_booked_count >= total_max_capacity

                slot_available = True
                unavailability_reason = None

                if is_booked:
                    slot_available = False
                    unavailability_reason = "Already Booked"
                elif is_past and not allow_past:
                    slot_available = False
                    unavailability_reason = "Past Slot"
                elif outside_window and not is_walk_in:
                    slot_available = False
                    unavailability_reason = f"Booking opens {booking_window_hours}h before appointment"
                elif capacity_exceeded:
                    slot_available = False
                    unavailability_reason = "Capacity Full"

                generated_slots.append(
                    {
                        "time": slot_time,
                        "time_str": slot_time.strftime("%H:%M"),
                        "formatted_time": slot_time.strftime("%I:%M %p"),
                        "session_name": "General Session",
                        "chamber": getattr(doctor.profile, "chamber_number", ""),
                        "is_available": slot_available,
                        "is_booked": is_booked,
                        "reason": unavailability_reason,
                        "slot_datetime": slot_aware_dt,
                    }
                )
                current_dt += timedelta(minutes=slot_duration)

    result["slots"] = generated_slots
    result["max_capacity"] = total_max_capacity
    result["remaining_capacity"] = max(0, total_max_capacity - total_booked_count)
    result["is_full"] = total_booked_count >= total_max_capacity
    return result
