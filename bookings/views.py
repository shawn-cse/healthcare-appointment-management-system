from datetime import datetime, timedelta, date
from django.shortcuts import render, redirect, get_object_or_404
from django.views.generic import View
from django.http import HttpRequest, Http404, JsonResponse
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib import messages
from django.views.generic.base import TemplateView
from django.core.exceptions import ValidationError

from accounts.models import User
from bookings.models import Booking
from bookings.services.fee_calculator import calculate_visit_stage_and_fee
from bookings.services.booking_service import create_appointment
from doctors.services.availability import generate_doctor_slots


class BookingView(LoginRequiredMixin, View):
    """
    Patient-facing doctor booking interface for Green Hospital.
    - Generates calendar of next 7 days.
    - Displays computed slots enforcing 48-hour booking window server-side.
    - Shows deterministic visit fee calculation (First -> Second -> Third -> First ...).
    - Prevents booking unapproved or suspended doctors.
    """
    template_name = "bookings/booking.html"

    def get_week_dates(self):
        """Get the next 7 days starting from today in Asia/Dhaka"""
        today = datetime.now().date()
        week_dates = []
        for i in range(7):
            d = today + timedelta(days=i)
            week_dates.append(
                {
                    "date": d,
                    "day": d.strftime("%a"),
                    "day_num": d.strftime("%d"),
                    "month": d.strftime("%b"),
                    "year": d.strftime("%Y"),
                    "full_date": d.strftime("%Y-%m-%d"),
                }
            )
        return week_dates

    def get(self, request: HttpRequest, *args, **kwargs):
        username = kwargs.get("username")
        try:
            doctor = (
                User.objects.select_related("profile")
                .prefetch_related("weekly_schedules")
                .get(
                    username=username,
                    role=User.RoleChoices.DOCTOR,
                    status=User.StatusChoices.ACTIVE,
                    is_active=True,
                )
            )
        except User.DoesNotExist:
            raise Http404("Doctor not found or not approved to accept appointments.")

        week_dates = self.get_week_dates()
        selected_date_str = request.GET.get("date", week_dates[0]["full_date"])
        try:
            selected_date = datetime.strptime(selected_date_str, "%Y-%m-%d").date()
        except ValueError:
            selected_date = datetime.strptime(week_dates[0]["full_date"], "%Y-%m-%d").date()
            selected_date_str = week_dates[0]["full_date"]

        # Calculate live visit fees for this patient
        regular_pricing = calculate_visit_stage_and_fee(
            patient=request.user, doctor=doctor, visit_type=Booking.VisitType.REGULAR
        )
        report_pricing = calculate_visit_stage_and_fee(
            patient=request.user, doctor=doctor, visit_type=Booking.VisitType.REPORT_CHECK
        )

        # Generate schedule slots for the whole week
        schedule = {}
        schedule_info = {}
        for d_info in week_dates:
            d_obj = d_info["date"]
            slot_res = generate_doctor_slots(doctor, d_obj)
            schedule[d_info["full_date"]] = slot_res["slots"]
            schedule_info[d_info["full_date"]] = slot_res

        context = {
            "doctor": doctor,
            "week_dates": week_dates,
            "schedule": schedule,
            "schedule_info": schedule_info,
            "selected_date": selected_date_str,
            "selected_slots": schedule.get(selected_date_str, []),
            "regular_pricing": regular_pricing,
            "report_pricing": report_pricing,
            "current_visit_stage": regular_pricing["visit_stage"],
            "current_regular_fee": regular_pricing["fee_amount"],
            "report_fee": report_pricing["fee_amount"],
        }

        return render(request, self.template_name, context)


class BookingCreateView(LoginRequiredMixin, View):
    """
    Submits appointment booking using transaction-safe booking service:
    - Enforces 48-hour boundary condition server-side.
    - Prevents double-booking and capacity overflow.
    - Allocates daily serial number scoped to doctor & date.
    - Locks in snapshot consultation fee.
    """
    template_name = "bookings/booking.html"

    def get(self, request: HttpRequest, *args, **kwargs):
        username = kwargs.get("username")
        return redirect("bookings:doctor-booking-view", username=username)

    def post(self, request, username):
        doctor = get_object_or_404(
            User,
            username=username,
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            is_active=True,
        )

        date_str = request.POST.get("selected_date")
        time_str = request.POST.get("selected_time")
        visit_type = request.POST.get("visit_type", Booking.VisitType.REGULAR)
        payment_method = request.POST.get("payment_method", Booking.PaymentMethod.PAY_AT_CHAMBER)
        notes = request.POST.get("notes", "").strip()

        if not date_str or not time_str:
            messages.error(request, "Please select both date and time for the appointment.")
            return redirect("bookings:doctor-booking-view", username=username)

        try:
            appointment_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            appointment_time = datetime.strptime(time_str, "%H:%M").time()
        except (ValueError, TypeError):
            messages.error(request, "Invalid date or time format provided.")
            return redirect("bookings:doctor-booking-view", username=username)

        try:
            booking = create_appointment(
                doctor=doctor,
                patient=request.user,
                appointment_date=appointment_date,
                appointment_time=appointment_time,
                visit_type=visit_type,
                payment_method=payment_method,
                admin_notes=notes,
                actor=request.user,
            )
            messages.success(
                request,
                f"Appointment booked successfully! Your Daily Serial Number is #{booking.serial_number} (Ref: {booking.appointment_reference})."
            )
            return redirect("bookings:booking-success", booking_id=booking.id)
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))
            return redirect("bookings:doctor-booking-view", username=username)


class BookingPricingQuoteView(LoginRequiredMixin, View):
    """
    JSON API endpoint returning quoted fee and visit stage before booking confirmation.
    """
    def get(self, request):
        doctor_id = request.GET.get("doctor_id")
        visit_type = request.GET.get("visit_type", Booking.VisitType.REGULAR)
        doctor = get_object_or_404(User, id=doctor_id, role=User.RoleChoices.DOCTOR)

        pricing = calculate_visit_stage_and_fee(
            patient=request.user,
            doctor=doctor,
            visit_type=visit_type,
        )

        return JsonResponse({
            "success": True,
            "visit_type": pricing["visit_type"],
            "visit_type_display": pricing["visit_type_display"],
            "visit_stage": pricing["visit_stage"],
            "stage_display": pricing["stage_display"],
            "fee_amount": str(pricing["fee_amount"]),
            "currency": "BDT",
        })


class BookingSuccessView(LoginRequiredMixin, TemplateView):
    template_name = "bookings/booking-success.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        booking = get_object_or_404(
            Booking.objects.select_related("doctor", "doctor__profile", "patient"),
            id=kwargs["booking_id"],
        )
        # Isolation: Only patient, doctor, or assigned receptionist/admin can view
        user = self.request.user
        if not (user == booking.patient or user == booking.doctor or user.can_access_doctor(booking.doctor)):
            raise Http404("Booking not found.")

        context["booking"] = booking
        return context


class BookingInvoiceView(LoginRequiredMixin, TemplateView):
    template_name = "bookings/booking-invoice.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        booking = get_object_or_404(
            Booking.objects.select_related(
                "doctor", "doctor__profile", "patient", "patient__profile"
            ),
            id=kwargs["booking_id"],
        )

        user = self.request.user
        if not (
            user == booking.patient
            or user == booking.doctor
            or user.can_access_doctor(booking.doctor)
        ):
            raise Http404("Not found")

        context["booking"] = booking
        context["issued_date"] = booking.booking_date.strftime("%d/%m/%Y")
        # Snapshot fee protection: use locked fee_amount
        context["subtotal"] = booking.fee_amount
        context["total"] = booking.fee_amount
        return context


class BookingListView(LoginRequiredMixin, View):
    template_name = "bookings/booking-list.html"

    def get(self, request: HttpRequest, *args, **kwargs):
        if request.user.role == User.RoleChoices.DOCTOR:
            bookings = Booking.objects.filter(doctor=request.user)
        elif request.user.role == User.RoleChoices.RECEPTIONIST:
            bookings = Booking.objects.filter(
                doctor__in=request.user.get_assigned_doctors()
            )
        elif request.user.is_staff_admin:
            bookings = Booking.objects.all()
        else:
            bookings = Booking.objects.filter(patient=request.user)

        bookings = bookings.select_related(
            "doctor",
            "doctor__profile",
            "patient",
            "patient__profile",
        ).order_by("-appointment_date", "serial_number", "-appointment_time")

        context = {
            "bookings": bookings,
        }
        return render(request, self.template_name, context)
