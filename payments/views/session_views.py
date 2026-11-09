from datetime import datetime
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.views import View

from accounts.models import User
from doctors.services.availability import detect_affected_appointments
from payments.services.session_cancellation_service import cancel_doctor_consultation_session


class DoctorCancelSessionView(LoginRequiredMixin, View):
    """
    Interface for doctors and hospital administrators to cancel a consultation session or entire day:
    - Blocks further bookings by creating DoctorAvailabilityException.
    - Transitions all affected bookings to CANCELLED with reason.
    - Paid patients automatically receive 100% refund eligibility and RefundRequests.
    - Unpaid bookings are safely cancelled without creating monetary refund transactions.
    - Preserves all appointment and financial audit records.
    """
    template_name = "doctors/cancel_session.html"

    def get(self, request: HttpRequest, doctor_id: int = None):
        if doctor_id:
            doctor = get_object_or_404(User, id=doctor_id, role=User.RoleChoices.DOCTOR)
        else:
            doctor = request.user

        if not request.user.can_access_doctor(doctor) and not request.user.is_staff_admin:
            raise PermissionDenied("You are not authorized to cancel sessions for this doctor.")

        target_date_str = request.GET.get("date")
        target_date = None
        affected = []
        if target_date_str:
            try:
                target_date = datetime.strptime(target_date_str, "%Y-%m-%d").date()
                affected = detect_affected_appointments(doctor=doctor, target_date=target_date)
            except ValueError:
                pass

        context = {
            "doctor": doctor,
            "target_date": target_date_str,
            "affected_appointments": affected,
            "affected_count": len(affected),
        }
        return render(request, self.template_name, context)

    def post(self, request: HttpRequest, doctor_id: int = None):
        if doctor_id:
            doctor = get_object_or_404(User, id=doctor_id, role=User.RoleChoices.DOCTOR)
        else:
            doctor = request.user

        if not request.user.can_access_doctor(doctor) and not request.user.is_staff_admin:
            raise PermissionDenied("You are not authorized to cancel sessions for this doctor.")

        date_str = request.POST.get("target_date", "").strip()
        reason = request.POST.get("reason", "").strip()
        start_time_str = request.POST.get("start_time", "").strip()
        end_time_str = request.POST.get("end_time", "").strip()

        if not date_str:
            messages.error(request, "Target date is required.")
            return redirect("doctors:dashboard")
        if not reason:
            messages.error(request, "A cancellation reason is required.")
            return redirect("doctors:dashboard")

        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            messages.error(request, "Invalid date format.")
            return redirect("doctors:dashboard")

        start_time = None
        end_time = None
        if start_time_str and end_time_str:
            try:
                start_time = datetime.strptime(start_time_str, "%H:%M").time()
                end_time = datetime.strptime(end_time_str, "%H:%M").time()
            except ValueError:
                pass

        try:
            summary = cancel_doctor_consultation_session(
                doctor=doctor,
                target_date=target_date,
                start_time=start_time,
                end_time=end_time,
                reason=reason,
                actor=request.user,
            )
            messages.warning(
                request,
                f"Session on {target_date} cancelled successfully. "
                f"{summary['total_affected']} appointments cancelled ({summary['paid_count']} paid patients granted 100% refund eligibility)."
            )
        except (ValidationError, PermissionDenied) as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        if request.user.is_doctor:
            return redirect("doctors:dashboard")
        return redirect("admin-appointments")
