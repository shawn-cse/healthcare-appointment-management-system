from decimal import Decimal
from bookings.models import Booking


def calculate_visit_stage_and_fee(patient, doctor, visit_type="regular") -> dict:
    """
    Computes deterministic visit stage and consultation fee in BDT for a patient-doctor pair.
    
    Visit Fee Cycle:
    - Counts completed regular visits: Booking.objects.filter(doctor=doctor, patient=patient, visit_type='regular', status='completed').count()
    - Next regular visit cycles:
      First (stage 1) -> Second (stage 2) -> Third (stage 3) -> First (stage 1) ...
      Formula: (completed_count % 3) + 1
    - Report-check appointments use separate report-check fee and DO NOT advance the sequence.
    - Cancelled and No-Show appointments never count.
    - Returns accurate monetary Decimal values.
    """
    prof = getattr(doctor, "profile", None)
    if not prof:
        fee_first = Decimal("1000.00")
        fee_second = Decimal("800.00")
        fee_third = Decimal("600.00")
        fee_report = Decimal("300.00")
    else:
        fee_first = prof.fee_first_visit or Decimal("1000.00")
        fee_second = prof.fee_second_visit or Decimal("800.00")
        fee_third = prof.fee_third_visit or Decimal("600.00")
        fee_report = prof.fee_report_check or Decimal("300.00")

    if visit_type == Booking.VisitType.REPORT_CHECK or visit_type == "report_check":
        return {
            "visit_type": Booking.VisitType.REPORT_CHECK,
            "visit_type_display": "Report Checking",
            "visit_stage": None,
            "stage_display": "Report Check (Does not advance cycle)",
            "fee_amount": fee_report,
            "completed_regular_visits": 0,
        }

    # Regular consultation sequence
    completed_regular_visits = Booking.objects.filter(
        doctor=doctor,
        patient=patient,
        visit_type=Booking.VisitType.REGULAR,
        status=Booking.StatusChoices.COMPLETED,
    ).count()

    stage = (completed_regular_visits % 3) + 1
    if stage == 1:
        fee = fee_first
        stage_display = "1st Regular Visit"
    elif stage == 2:
        fee = fee_second
        stage_display = "2nd Regular Visit"
    elif stage == 3:
        fee = fee_third
        stage_display = "3rd Regular Visit"
    else:
        fee = fee_first
        stage_display = "1st Regular Visit"

    return {
        "visit_type": Booking.VisitType.REGULAR,
        "visit_type_display": "Regular Consultation",
        "visit_stage": stage,
        "stage_display": stage_display,
        "fee_amount": fee,
        "completed_regular_visits": completed_regular_visits,
    }


calculate_patient_visit_fee = calculate_visit_stage_and_fee
