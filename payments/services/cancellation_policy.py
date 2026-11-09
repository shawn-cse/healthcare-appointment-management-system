from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from django.utils import timezone

from doctors.services.availability import DHAKA_TZ


@dataclass
class CancellationPolicyResult:
    is_eligible_for_refund: bool
    refund_percentage: int
    policy_rule: str
    hours_before_start: Decimal
    original_paid_amount: Decimal
    refundable_amount: Decimal
    is_unpaid: bool


def calculate_cancellation_refund_eligibility(
    booking,
    current_time: Optional[datetime] = None,
    cancellation_actor_type: str = "patient",
) -> CancellationPolicyResult:
    """
    Green Hospital Authoritative Cancellation and Refund Policy (Dhaka Timezone):

    Patient Cancellation Policy:
    Calculate the difference between the scheduled appointment start and authoritative
    current server time in Asia/Dhaka.
    - >= 24 hours before appointment start -> 100% refund.
    - Exactly 24 hours before appointment start -> 100% refund.
    - Less than 24 hours before start, but before appointment starts (> 0 sec) -> 80% refund.
    - At or after appointment start (<= 0 sec) -> 0% automatic refund; admin exception review only.

    Doctor / Hospital Cancellation:
    - Paid patients are always eligible for 100% refund regardless of cancellation timing.

    Financial Integrity:
    - Calculate a refund ONLY from money actually paid.
    - An unpaid appointment has nothing to refund and should not create a monetary refund transaction.
    - Never refund more than the net paid amount remaining after previous refunds.
    """
    # Authoritative current time in Asia/Dhaka
    if current_time is None:
        current_time = timezone.now().astimezone(DHAKA_TZ)
    elif current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=DHAKA_TZ)
    else:
        current_time = current_time.astimezone(DHAKA_TZ)

    # Appointment start datetime in Asia/Dhaka
    appointment_start = datetime.combine(
        booking.appointment_date, booking.appointment_time
    ).replace(tzinfo=DHAKA_TZ)

    # Time delta
    time_diff = appointment_start - current_time
    total_seconds = Decimal(str(time_diff.total_seconds()))
    hours_before_start = (total_seconds / Decimal("3600")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )

    # Determine money actually paid
    successful_txs = booking.payment_transactions.filter(
        status__in=["success", "partially_refunded"]
    )
    if not successful_txs.exists() or booking.payment_status == "unpaid":
        paid_amount = Decimal("0.00")
        is_unpaid = True
    else:
        # Sum of net remaining paid amount across successful transactions
        paid_amount = sum(tx.net_paid_remaining for tx in successful_txs)
        is_unpaid = paid_amount <= Decimal("0.00")

    # Evaluate percentage according to cancellation source
    if cancellation_actor_type in ("doctor", "hospital"):
        refund_percentage = 100
        policy_rule = "doctor_hospital_cancellation_100_percent"
    else:
        # Patient cancellation
        twenty_four_hours = timedelta(hours=24)
        if time_diff >= twenty_four_hours:
            refund_percentage = 100
            policy_rule = "patient_cancellation_24h_or_more_100_percent"
        elif time_diff > timedelta(seconds=0):
            refund_percentage = 80
            policy_rule = "patient_cancellation_under_24h_80_percent"
        else:
            refund_percentage = 0
            policy_rule = "patient_cancellation_after_start_admin_exception_only"

    # Strict decimal-safe calculation
    if is_unpaid or refund_percentage == 0:
        refundable_amount = Decimal("0.00")
        is_eligible = False if is_unpaid else (refund_percentage > 0)
    elif refund_percentage == 100:
        refundable_amount = paid_amount
        is_eligible = True
    elif refund_percentage == 80:
        # 80% with decimal-safe half-up rounding
        refundable_amount = (paid_amount * Decimal("0.80")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        is_eligible = True
    else:
        refundable_amount = Decimal("0.00")
        is_eligible = False

    # Financial integrity boundary: never refund more than paid_amount
    refundable_amount = min(refundable_amount, paid_amount)

    return CancellationPolicyResult(
        is_eligible_for_refund=is_eligible,
        refund_percentage=refund_percentage,
        policy_rule=policy_rule,
        hours_before_start=hours_before_start,
        original_paid_amount=paid_amount,
        refundable_amount=refundable_amount,
        is_unpaid=is_unpaid,
    )
