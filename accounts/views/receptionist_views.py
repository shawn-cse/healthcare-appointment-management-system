from datetime import datetime, date
from django.contrib import messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.generic import ListView, TemplateView, View

from accounts.decorators import ReceptionistRequiredMixin
from accounts.models import User, AuditLog, log_audit_event
from bookings.models import Booking
from bookings.services.booking_service import create_appointment
from bookings.services.fee_calculator import calculate_visit_stage_and_fee
from doctors.services.availability import generate_doctor_slots


class ReceptionistDashboardView(ReceptionistRequiredMixin, TemplateView):
    """
    Operational dashboard for receptionists in Green Hospital.
    Shows ONLY doctors to whom this receptionist is explicitly assigned.
    Displays daily serial numbers, queue/attendance status, and remaining capacity.
    """
    template_name = "receptionist/dashboard.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        receptionist = self.request.user
        assigned_doctors = receptionist.get_assigned_doctors().select_related("profile")

        today = timezone.now().date()
        today_appointments = (
            Booking.objects.filter(
                doctor__in=assigned_doctors,
                appointment_date=today,
            )
            .select_related("doctor", "doctor__profile", "patient", "patient__profile")
            .order_by("serial_number", "appointment_time")
        )

        # Compute capacity for each assigned doctor today
        doctor_capacity_stats = []
        for doc in assigned_doctors:
            slots_data = generate_doctor_slots(doc, today, allow_past=True, is_walk_in=True)
            doctor_capacity_stats.append({
                "doctor": doc,
                "booked_count": slots_data["booked_count"],
                "max_capacity": slots_data["max_capacity"],
                "remaining_capacity": slots_data["remaining_capacity"],
                "is_full": slots_data["is_full"],
            })

        context["assigned_doctors"] = assigned_doctors
        context["today_appointments"] = today_appointments
        context["total_assigned_doctors"] = assigned_doctors.count()
        context["today_appointments_count"] = today_appointments.count()
        context["checked_in_count"] = today_appointments.filter(status=Booking.StatusChoices.CHECKED_IN).count()
        context["completed_count"] = today_appointments.filter(status=Booking.StatusChoices.COMPLETED).count()
        context["doctor_capacity_stats"] = doctor_capacity_stats
        return context


class ReceptionistDoctorAppointmentsView(ReceptionistRequiredMixin, ListView):
    """
    View appointments for a specific assigned doctor.
    Enforces that the receptionist CANNOT view appointments of unassigned doctors.
    """
    template_name = "receptionist/appointments.html"
    context_object_name = "appointments"
    paginate_by = 20

    def get_queryset(self):
        doctor_id = self.kwargs.get("doctor_id")
        doctor = get_object_or_404(User, id=doctor_id, role=User.RoleChoices.DOCTOR)

        if not self.request.user.can_access_doctor(doctor):
            raise PermissionDenied(
                f"Access denied: You are not assigned to Dr. {doctor.get_full_name()}"
            )

        qs = (
            Booking.objects.filter(doctor=doctor)
            .select_related("patient", "patient__profile")
            .order_by("-appointment_date", "serial_number")
        )
        date_filter = self.request.GET.get("date")
        if date_filter:
            try:
                parsed_date = datetime.strptime(date_filter, "%Y-%m-%d").date()
                qs = qs.filter(appointment_date=parsed_date)
            except ValueError:
                pass
        return qs

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        doctor_id = self.kwargs.get("doctor_id")
        context["doctor"] = get_object_or_404(User, id=doctor_id)
        context["selected_date"] = self.request.GET.get("date", "")
        return context


class ReceptionistCheckInView(ReceptionistRequiredMixin, View):
    """
    Transitions appointment to checked_in status.
    Only permitted for doctors assigned to this receptionist.
    """
    def post(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        if not request.user.can_access_doctor(booking.doctor):
            raise PermissionDenied(
                "Access denied: You cannot check in patients for unassigned doctors."
            )

        try:
            booking.transition_to(Booking.StatusChoices.CHECKED_IN, actor=request.user)
            messages.success(
                request,
                f"Patient {booking.patient.get_full_name()} (Serial #{booking.serial_number}) checked in successfully."
            )
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect(request.META.get("HTTP_REFERER") or "accounts:receptionist-dashboard")


class ReceptionistNoShowView(ReceptionistRequiredMixin, View):
    """
    Transitions appointment to no_show status.
    """
    def post(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        if not request.user.can_access_doctor(booking.doctor):
            raise PermissionDenied(
                "Access denied: You cannot mark no-show for unassigned doctors."
            )

        try:
            booking.transition_to(Booking.StatusChoices.NO_SHOW, actor=request.user)
            messages.info(
                request,
                f"Appointment for {booking.patient.get_full_name()} marked as No Show."
            )
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect(request.META.get("HTTP_REFERER") or "accounts:receptionist-dashboard")


class ReceptionistCancelView(ReceptionistRequiredMixin, View):
    """
    Cancels an appointment with a stated reason.
    """
    def post(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        if not request.user.can_access_doctor(booking.doctor):
            raise PermissionDenied(
                "Access denied: You cannot cancel appointments for unassigned doctors."
            )

        reason = request.POST.get("reason", "Cancelled by reception desk.")
        try:
            booking.transition_to(Booking.StatusChoices.CANCELLED, actor=request.user, reason=reason)
            messages.warning(
                request,
                f"Appointment #{booking.serial_number} has been cancelled."
            )
            if booking.payment_status in (Booking.PaymentStatus.PAID, Booking.PaymentStatus.PARTIALLY_REFUNDED):
                from payments.services.refund_service import create_refund_request
                refund_req = create_refund_request(
                    booking=booking,
                    patient=booking.patient,
                    reason=f"Clinic cancelled appointment: {reason}",
                    cancellation_type="hospital",
                    current_time=timezone.now(),
                    actor=request.user,
                )
                if refund_req:
                    messages.info(
                        request,
                        f"100% refund request (#{refund_req.refund_reference}) of {refund_req.requested_amount} BDT created for patient {booking.patient.get_full_name()}."
                    )
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect(request.META.get("HTTP_REFERER") or "accounts:receptionist-dashboard")


class ReceptionistAddNotesView(ReceptionistRequiredMixin, View):
    """
    Record appointment-related administrative notes.
    """
    def post(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        if not request.user.can_access_doctor(booking.doctor):
            raise PermissionDenied(
                "Access denied: You cannot update notes for unassigned doctors."
            )

        notes = request.POST.get("admin_notes", "").strip()
        booking.admin_notes = notes
        booking.save()
        messages.success(request, "Administrative notes updated.")
        return redirect(request.META.get("HTTP_REFERER") or "accounts:receptionist-dashboard")


class ReceptionistWalkInBookingView(ReceptionistRequiredMixin, View):
    """
    Enables receptionists to register or select a patient and create a walk-in booking
    for an assigned doctor, strictly respecting doctor availability, capacity,
    and automatic visit-fee calculation.
    """
    template_name = "receptionist/walk_in_booking.html"

    def get(self, request, doctor_id=None):
        assigned_doctors = request.user.get_assigned_doctors()
        selected_doctor = None
        if doctor_id:
            selected_doctor = get_object_or_404(assigned_doctors, id=doctor_id)
        elif assigned_doctors.exists():
            selected_doctor = assigned_doctors.first()

        today = timezone.now().date()
        slots_data = None
        if selected_doctor:
            slots_data = generate_doctor_slots(selected_doctor, today, is_walk_in=True)

        patients = User.objects.filter(role=User.RoleChoices.PATIENT, is_active=True).order_by("first_name", "last_name")[:50]

        context = {
            "assigned_doctors": assigned_doctors,
            "selected_doctor": selected_doctor,
            "today": today,
            "slots_data": slots_data,
            "patients": patients,
        }
        return render(request, self.template_name, context)

    def post(self, request, doctor_id=None):
        doc_id = request.POST.get("doctor_id") or doctor_id
        doctor = get_object_or_404(User, id=doc_id, role=User.RoleChoices.DOCTOR)

        # Authorization: Must be assigned to this doctor
        if not request.user.can_access_doctor(doctor):
            raise PermissionDenied("You are not authorized to create walk-in bookings for this doctor.")

        # Resolve or create patient
        patient_id = request.POST.get("patient_id")
        if patient_id == "new" or not patient_id:
            # Register new walk-in patient
            first_name = request.POST.get("first_name", "").strip()
            last_name = request.POST.get("last_name", "").strip()
            phone = request.POST.get("phone", "").strip()
            username = request.POST.get("username", "").strip() or f"patient_{int(timezone.now().timestamp())}"

            if not first_name or not last_name:
                messages.error(request, "Patient first and last names are required.")
                return redirect("accounts:receptionist-walk-in", doctor_id=doctor.id)

            patient = User.objects.create_user(
                username=username,
                first_name=first_name,
                last_name=last_name,
                role=User.RoleChoices.PATIENT,
                status=User.StatusChoices.ACTIVE,
            )
            patient.profile.phone = phone
            patient.profile.save()
        else:
            patient = get_object_or_404(User, id=patient_id, role=User.RoleChoices.PATIENT)

        time_str = request.POST.get("selected_time") or request.POST.get("appointment_time")
        date_str = request.POST.get("selected_date") or request.POST.get("appointment_date") or str(timezone.now().date())
        visit_type = request.POST.get("visit_type", "regular")
        admin_notes = request.POST.get("admin_notes", "Walk-in registration at reception.")

        try:
            appointment_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            appointment_time = datetime.strptime(time_str, "%H:%M").time()
        except (ValueError, TypeError):
            messages.error(request, "Invalid date or time provided.")
            return redirect("accounts:receptionist-walk-in-doctor", doctor_id=doctor.id)

        try:
            booking = create_appointment(
                doctor=doctor,
                patient=patient,
                appointment_date=appointment_date,
                appointment_time=appointment_time,
                visit_type=visit_type,
                payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
                admin_notes=admin_notes,
                is_walk_in=True,
                actor=request.user,
            )
            messages.success(
                request,
                f"Walk-in appointment booked for {patient.get_full_name()}! Serial #{booking.serial_number} (Ref: {booking.appointment_reference})"
            )
            return redirect("accounts:receptionist-dashboard")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))
            return redirect("accounts:receptionist-walk-in", doctor_id=doctor.id)


class ReceptionistReportsView(ReceptionistRequiredMixin, View):
    """
    Daily appointment, check-in, queue, and chamber-payment summaries for assigned doctors only.
    Includes CSV export of daily patient queue.
    """
    template_name = "receptionist/reports.html"

    def get(self, request):
        import csv
        from decimal import Decimal
        from django.http import HttpResponse
        from django.db.models import Sum

        receptionist = request.user
        assigned_doctors = receptionist.get_assigned_doctors().select_related("profile")

        date_str = request.GET.get("date")
        if date_str:
            try:
                selected_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                selected_date = timezone.now().date()
        else:
            selected_date = timezone.now().date()

        doctor_id = request.GET.get("doctor_id")
        doctors_qs = assigned_doctors
        if doctor_id:
            doctors_qs = doctors_qs.filter(id=doctor_id)

        appointments_qs = Booking.objects.filter(
            doctor__in=doctors_qs,
            appointment_date=selected_date,
        ).select_related("doctor", "patient", "patient__profile").order_by("doctor__first_name", "serial_number", "appointment_time")

        if request.GET.get("export") == "csv":
            response = HttpResponse(content_type="text/csv")
            response["Content-Disposition"] = f'attachment; filename="receptionist_queue_{selected_date}.csv"'
            writer = csv.writer(response)
            writer.writerow([
                "Serial #",
                "Appointment Reference",
                "Doctor",
                "Patient Name",
                "Contact Phone",
                "Time",
                "Visit Type",
                "Payment Status",
                "Consultation Status",
                "Fee (BDT)",
            ])
            for app in appointments_qs:
                phone = getattr(app.patient.profile, "phone", "") if hasattr(app.patient, "profile") else ""
                writer.writerow([
                    app.serial_number,
                    app.appointment_reference or "",
                    f"Dr. {app.doctor.get_full_name()}",
                    app.patient.get_full_name(),
                    phone,
                    app.appointment_time.strftime("%I:%M %p"),
                    app.get_visit_type_display(),
                    app.get_payment_status_display(),
                    app.get_status_display(),
                    str(app.fee_amount),
                ])
            return response

        total_count = appointments_qs.count()
        checked_in_count = appointments_qs.filter(status=Booking.StatusChoices.CHECKED_IN).count()
        completed_count = appointments_qs.filter(status=Booking.StatusChoices.COMPLETED).count()
        unpaid_count = appointments_qs.filter(payment_status=Booking.PaymentStatus.UNPAID).count()
        paid_count = appointments_qs.filter(payment_status=Booking.PaymentStatus.PAID).count()

        # Chamber payment collection total for these appointments
        from payments.models import PaymentTransaction
        chamber_collected = PaymentTransaction.objects.filter(
            booking__in=appointments_qs,
            status=PaymentTransaction.Status.SUCCESS,
            payment_method__in=[PaymentTransaction.PaymentMethod.CASH, PaymentTransaction.PaymentMethod.CHAMBER_POS],
        ).aggregate(t=Sum("amount"))["t"] or Decimal("0.00")

        context = {
            "selected_date": selected_date,
            "assigned_doctors": assigned_doctors,
            "selected_doctor_id": int(doctor_id) if doctor_id and str(doctor_id).isdigit() else "",
            "appointments": appointments_qs,
            "total_count": total_count,
            "checked_in_count": checked_in_count,
            "completed_count": completed_count,
            "unpaid_count": unpaid_count,
            "paid_count": paid_count,
            "chamber_collected": chamber_collected,
        }
        return render(request, self.template_name, context)

