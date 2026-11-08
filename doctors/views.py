import json
from datetime import datetime, date, time, timedelta

from django.core.exceptions import PermissionDenied, ValidationError
from django.contrib.auth import logout
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.auth.decorators import login_required
from django.http import (
    HttpRequest,
    HttpResponse,
    Http404,
    HttpResponsePermanentRedirect,
    JsonResponse,
)
from django.shortcuts import render, get_object_or_404, redirect
from django.urls import reverse_lazy
from django.views import generic
from django.views.generic import (
    ListView,
    DetailView,
    View,
    CreateView,
    UpdateView,
)
from django.views.generic.base import TemplateView
from rest_framework.generics import UpdateAPIView
from rest_framework.response import Response
from django.db.models import Q
from django.db.models import Count
from django.utils import timezone
from django.contrib import messages
from django.contrib.auth import update_session_auth_hash

from bookings.models import Booking, Prescription
from core.decorators import user_is_doctor
from doctors.forms import DoctorProfileForm, PrescriptionForm
from doctors.models import Experience
from doctors.models.general import *
from doctors.models.schedules import (
    DoctorWeeklySchedule,
    DoctorScheduleBreak,
    DoctorAvailabilityException,
    HospitalSetting,
)
from doctors.services.availability import (
    generate_doctor_slots,
    check_schedule_overlap,
    detect_affected_appointments,
    DHAKA_TZ,
    get_dhaka_now,
)
from doctors.serializers import (
    EducationSerializer,
    ExperienceSerializer,
    RegistrationNumberSerializer,
    SpecializationSerializer,
)
from mixins.custom_mixins import DoctorRequiredMixin
from patients.forms import ChangePasswordForm
from utils.htmx import render_toast_message_for_api
from accounts.models import User

days = {
    0: Sunday,
    1: Monday,
    2: Tuesday,
    3: Wednesday,
    4: Thursday,
    5: Friday,
    6: Saturday,
}


class DoctorDashboardView(DoctorRequiredMixin, TemplateView):
    template_name = "doctors/dashboard.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        today = timezone.now().date()
        doctor = self.request.user

        # Get appointment counts
        context["total_patients"] = (
            Booking.objects.filter(doctor=doctor)
            .values("patient")
            .distinct()
            .count()
        )

        today_bookings = (
            Booking.objects.select_related("patient", "patient__profile")
            .filter(doctor=doctor, appointment_date=today)
            .order_by("serial_number", "appointment_time")
        )

        context["today_patients"] = today_bookings.count()
        context["total_appointments"] = Booking.objects.filter(doctor=doctor).count()

        # Slot and Capacity metrics for today
        slot_info = generate_doctor_slots(doctor, today, allow_past=True, is_walk_in=True)
        context["daily_max_capacity"] = slot_info.get("max_capacity", 0)
        context["daily_booked_capacity"] = slot_info.get("booked_count", 0)
        context["daily_remaining_capacity"] = slot_info.get("remaining_capacity", 0)
        context["is_capacity_full"] = slot_info.get("is_full", False)

        # Get upcoming appointments (strictly scoped to this doctor)
        context["upcoming_appointments"] = (
            Booking.objects.select_related("patient", "patient__profile")
            .filter(
                doctor=doctor,
                appointment_date__gte=today,
                status__in=[Booking.StatusChoices.PENDING, Booking.StatusChoices.CONFIRMED],
            )
            .order_by("appointment_date", "serial_number", "appointment_time")[:10]
        )

        # Get today's appointments ordered by serial number
        context["today_appointments"] = today_bookings
        context["completed_today"] = today_bookings.filter(status=Booking.StatusChoices.COMPLETED)
        context["waiting_today"] = today_bookings.filter(status__in=[Booking.StatusChoices.CONFIRMED, Booking.StatusChoices.CHECKED_IN])

        return context


def convert_to_24_hour_format(time_str):
    if time_str == "00:00 AM":
        time_str = "12:00 AM"
    return datetime.strptime(time_str, "%I:%M %p").time()


@login_required
@user_is_doctor
def schedule_timings(request: HttpRequest) -> HttpResponse:
    if request.method == "POST":
        data = request.POST
        for i in range(7):
            if data.get(f"day_{i}", None):
                start_times = data.getlist(f"start_time_{i}", default=[])
                end_times = data.getlist(f"end_time_{i}", default=[])
                for index in range(len(start_times)):
                    start = convert_to_24_hour_format(start_times[index])
                    end = convert_to_24_hour_format(end_times[index])
                    time_range, time_created = TimeRange.objects.get_or_create(
                        start=start, end=end
                    )
                    day, created = days[i].objects.get_or_create(
                        user=request.user
                    )
                    ranges = day.time_range
                    if time_range.id not in list(
                        ranges.values_list("id", flat=True)
                    ):
                        day.time_range.add(time_range)

        return HttpResponsePermanentRedirect(
            reverse_lazy("doctors:schedule-timings")
        )

    return render(request, "doctors/schedule-timings.html")


class DoctorProfileUpdateView(DoctorRequiredMixin, generic.UpdateView):
    model = User
    template_name = "doctors/profile-settings.html"
    form_class = DoctorProfileForm

    def get_object(self, queryset=None):
        return self.request.user


class DoctorProfileView(DetailView):
    context_object_name = "doctor"
    model = User
    slug_url_kwarg = "username"
    slug_field = "username"
    template_name = "doctors/profile.html"

    def get_object(self, queryset=None):
        if queryset is None:
            queryset = self.get_queryset()

        slug = self.kwargs.get(self.slug_url_kwarg)
        queryset = queryset.select_related("profile").prefetch_related(
            "educations",
            "experiences",
            "sunday__time_range",
            "monday__time_range",
            "tuesday__time_range",
            "wednesday__time_range",
            "thursday__time_range",
            "friday__time_range",
            "saturday__time_range",
        )

        try:
            obj = queryset.get(
                **{
                    self.slug_field: slug,
                    "role": User.RoleChoices.DOCTOR,
                    "status": User.StatusChoices.ACTIVE,
                    "is_active": True,
                }
            )
        except User.DoesNotExist:
            raise Http404("No approved doctor found matching the username")

        return obj

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        doctor = self.object

        # Get current day name
        current_day = datetime.now().strftime("%A")

        # Prepare business hours
        business_hours = {
            "Sunday": (
                doctor.sunday.time_range.all()
                if hasattr(doctor, "sunday")
                else []
            ),
            "Monday": (
                doctor.monday.time_range.all()
                if hasattr(doctor, "monday")
                else []
            ),
            "Tuesday": (
                doctor.tuesday.time_range.all()
                if hasattr(doctor, "tuesday")
                else []
            ),
            "Wednesday": (
                doctor.wednesday.time_range.all()
                if hasattr(doctor, "wednesday")
                else []
            ),
            "Thursday": (
                doctor.thursday.time_range.all()
                if hasattr(doctor, "thursday")
                else []
            ),
            "Friday": (
                doctor.friday.time_range.all()
                if hasattr(doctor, "friday")
                else []
            ),
            "Saturday": (
                doctor.saturday.time_range.all()
                if hasattr(doctor, "saturday")
                else []
            ),
        }

        context.update(
            {
                "current_day": current_day,
                "business_hours": business_hours,
                "reviews": doctor.reviews_received.select_related(
                    "patient", "patient__profile"
                ).order_by("-created_at"),
            }
        )

        return context


class UpdateEducationAPIView(DoctorRequiredMixin, UpdateAPIView):
    queryset = Experience.objects.all()
    serializer_class = EducationSerializer

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        serializer.save(user_id=self.request.user.id)

    def update(self, request, *args, **kwargs):
        data = request.POST
        ids = data.getlist("id", default=[])
        degrees = data.getlist("degree", default=[])
        colleges = data.getlist("college", default=[])
        years = data.getlist("year_of_completion", default=[])
        for i in range(len(degrees)):
            try:
                instance = self.request.user.educations.get(id=ids[i])
                degree = degrees[i]
                college = colleges[i]
                year_of_completion = years[i]
                serializer = self.get_serializer(
                    instance,
                    data={
                        "degree": degree,
                        "college": college,
                        "year_of_completion": year_of_completion,
                    },
                    partial=True,
                )
                serializer.is_valid(raise_exception=True)
                self.perform_update(serializer)
            except:
                degree = degrees[i]
                college = colleges[i]
                year_of_completion = years[i]
                serializer = self.get_serializer(
                    data={
                        "degree": degree,
                        "college": college,
                        "year_of_completion": year_of_completion,
                    }
                )
                serializer.is_valid(raise_exception=True)
                self.perform_update(serializer)

        response = Response({"success": True})
        response.headers["HX-Trigger"] = json.dumps(
            {
                "show-toast": {
                    "level": "success",
                    "title": "Education",
                    "message": "Successfully updated",
                }
            }
        )
        return response


class UpdateExperienceAPIView(DoctorRequiredMixin, UpdateAPIView):
    queryset = Experience.objects.all()
    serializer_class = ExperienceSerializer

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        serializer.save(user_id=self.request.user.id)

    def update(self, request, *args, **kwargs):
        data = request.POST
        ids = data.getlist("id", default=[])
        institutions = data.getlist("institution", default=[])
        from_years = data.getlist("from_year", default=[])
        to_years = data.getlist("to_year", default=[])
        designations = data.getlist("designation", default=[])

        for i in range(len(institutions)):
            try:
                instance = self.request.user.educations.get(id=ids[i])
                institution = institutions[i]
                from_year = from_years[i]
                to_year = to_years[i]
                designation = designations[i]
                serializer = self.get_serializer(
                    instance,
                    data={
                        "institution": institution,
                        "from_year": from_year,
                        "to_year": to_year,
                        "designation": designation,
                    },
                    partial=True,
                )
                serializer.is_valid(raise_exception=True)
                self.perform_update(serializer)
            except:
                institution = institutions[i]
                from_year = from_years[i]
                to_year = to_years[i]
                designation = designations[i]
                serializer = self.get_serializer(
                    data={
                        "institution": institution,
                        "from_year": from_year,
                        "to_year": to_year,
                        "designation": designation,
                    }
                )
                serializer.is_valid(raise_exception=True)
                self.perform_update(serializer)

        return render_toast_message_for_api(
            "Experience", "Updated successfully", "success"
        )


class UpdateRegistrationNumberAPIView(DoctorRequiredMixin, UpdateAPIView):
    serializer_class = RegistrationNumberSerializer

    def get_object(self):
        return self.request.user

    def update(self, request, *args, **kwargs):
        user = self.request.user
        data = request.POST
        new_reg = data.get("registration_number")
        new_bmdc = data.get("bmdc_number") or (str(new_reg) if new_reg else None)

        if new_bmdc and User.objects.filter(bmdc_number__iexact=new_bmdc).exclude(pk=user.pk).exists():
            return render_toast_message_for_api(
                "BMDC Registration", "Another doctor is already registered with this number.", "danger"
            )

        # Important changes to BMDC registration require administrative re-verification
        user.bmdc_number = new_bmdc
        user.bmdc_verified = False
        user.status = User.StatusChoices.PENDING_APPROVAL
        if new_reg and str(new_reg).isdigit():
            user.registration_number = int(new_reg)
        user.save()

        from accounts.models import log_audit_event, AuditLog
        log_audit_event(
            actor=user,
            action=AuditLog.ActionChoices.BMDC_UPDATED,
            target_user=user,
            details={"bmdc_number": new_bmdc, "reverification_required": True},
        )

        return render_toast_message_for_api(
            "BMDC Registration", "Updated. Administrative re-verification required.", "warning"
        )


class UpdateSpecializationAPIView(DoctorRequiredMixin, UpdateAPIView):
    serializer_class = SpecializationSerializer

    def get_object(self):
        return self.request.user

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        data = request.POST
        specialist = data.get("specialist")
        instance.profile.specialization = specialist
        instance.profile.save()

        return render_toast_message_for_api(
            "Specialization", "Updated successfully", "success"
        )


class DoctorsListView(ListView):
    model = User
    context_object_name = "doctors"
    template_name = "doctors/list.html"
    paginate_by = 10

    def get_queryset(self):
        # Strict Green Hospital requirement: Never display unapproved or suspended doctors
        queryset = self.model.objects.filter(
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            is_superuser=False,
            is_active=True,
        ).select_related("profile").prefetch_related("educations", "weekly_schedules")

        # Handle search query (Name, BMDC, Specialization, Department, City)
        search_query = self.request.GET.get("q")
        if search_query:
            queryset = queryset.filter(
                Q(first_name__icontains=search_query)
                | Q(last_name__icontains=search_query)
                | Q(bmdc_number__icontains=search_query)
                | Q(profile__specialization__icontains=search_query)
                | Q(profile__department__icontains=search_query)
                | Q(profile__city__icontains=search_query)
            )

        # Handle department filter
        department = self.request.GET.get("department")
        if department:
            queryset = queryset.filter(profile__department__icontains=department)

        # Handle fee filter
        max_fee = self.request.GET.get("max_fee")
        if max_fee:
            try:
                queryset = queryset.filter(profile__fee_first_visit__lte=float(max_fee))
            except ValueError:
                pass

        # Handle gender filter
        gender = self.request.GET.getlist("gender")
        if gender:
            queryset = queryset.filter(profile__gender__in=gender)

        # Handle specialization filter
        specializations = self.request.GET.getlist("specialization")
        if specializations:
            queryset = queryset.filter(
                profile__specialization__in=specializations
            )

        # Handle sorting
        sort_by = self.request.GET.get("sort")
        if sort_by:
            if sort_by == "price_low":
                queryset = queryset.order_by("profile__fee_first_visit")
            elif sort_by == "price_high":
                queryset = queryset.order_by(
                    "-profile__fee_first_visit"
                )
            elif sort_by == "rating":
                queryset = queryset.order_by("-rating")
            elif sort_by == "experience":
                queryset = queryset.order_by("-profile__experience")
        else:
            queryset = queryset.order_by("-pk")

        return queryset

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        context["search_query"] = self.request.GET.get("q")
        context["selected_department"] = self.request.GET.get("department", "")

        # Unique specializations & departments from approved doctors only
        approved_docs = User.objects.filter(
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            is_active=True,
        )
        specializations = (
            approved_docs.exclude(profile__specialization__isnull=True)
            .values_list("profile__specialization", flat=True)
            .distinct()
        )
        departments = (
            approved_docs.exclude(profile__department="")
            .values_list("profile__department", flat=True)
            .distinct()
        )

        context["specializations"] = sorted(list(filter(None, specializations)))
        context["departments"] = sorted(list(filter(None, departments)))
        context["selected_specializations"] = self.request.GET.getlist("specialization")
        context["selected_genders"] = self.request.GET.getlist("gender")
        context["selected_sort"] = self.request.GET.get("sort")
        context["max_fee"] = self.request.GET.get("max_fee", "")

        return context


class AppointmentListView(DoctorRequiredMixin, ListView):
    model = Booking
    context_object_name = "appointments"
    template_name = "doctors/appointments.html"
    paginate_by = 10

    def get_queryset(self):
        return (
            self.model.objects.select_related(
                "doctor", "doctor__profile", "patient", "patient__profile"
            )
            .filter(doctor=self.request.user)
            .order_by("-appointment_date", "-appointment_time")
        )


class AppointmentDetailView(LoginRequiredMixin, DetailView):
    model = Booking
    template_name = "doctors/appointment-detail.html"
    context_object_name = "appointment"

    def get_queryset(self):
        user = self.request.user
        if user.is_super_admin or user.is_hospital_admin:
            return Booking.objects.all()
        if user.is_doctor:
            return Booking.objects.filter(doctor=user)
        if user.is_receptionist:
            return Booking.objects.filter(doctor__in=user.get_assigned_doctors())
        return Booking.objects.none()

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        patient = self.object.patient

        # Get patient's appointment history with this doctor
        context["patient_history"] = (
            Booking.objects.select_related("doctor", "doctor__profile")
            .filter(
                doctor=self.request.user,
                patient=patient,
                appointment_date__lt=self.object.appointment_date,
            )
            .order_by("-appointment_date", "-appointment_time")
        )

        # Get total visits count
        context["total_visits"] = Booking.objects.filter(
            doctor=self.request.user, patient=patient, status="completed"
        ).count()

        return context


class AppointmentActionView(LoginRequiredMixin, View):
    def post(self, request, pk, action):
        user = request.user
        appointment = get_object_or_404(
            Booking,
            pk=pk,
        )
        if not user.can_access_doctor(appointment.doctor):
            raise PermissionDenied("You are not authorized to manage appointments for this doctor.")

        target_map = {
            "accept": Booking.StatusChoices.CONFIRMED,
            "cancel": Booking.StatusChoices.CANCELLED,
            "completed": Booking.StatusChoices.COMPLETED,
            "no_show": Booking.StatusChoices.NO_SHOW,
        }
        target_status = target_map.get(action)
        if not target_status:
            messages.error(request, "Invalid action.")
            return redirect("doctors:dashboard")

        reason = request.POST.get("reason", "")
        try:
            appointment.transition_to(target_status, actor=user, reason=reason)
            messages.success(request, f"Appointment status updated to {appointment.get_status_display()}.")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("doctors:dashboard")


class AppointmentCompleteView(DoctorRequiredMixin, View):
    """
    Doctor marks consultation as completed, records clinical findings,
    diagnosis, and prescription notes.
    """
    def post(self, request, pk):
        appointment = get_object_or_404(Booking, pk=pk, doctor=request.user)
        diagnosis = request.POST.get("diagnosis", "").strip()
        symptoms = request.POST.get("symptoms", "").strip()
        medications = request.POST.get("medications", "").strip()
        notes = request.POST.get("notes", "").strip()

        try:
            appointment.transition_to(Booking.StatusChoices.COMPLETED, actor=request.user)
            if diagnosis or symptoms or medications or notes:
                Prescription.objects.update_or_create(
                    booking=appointment,
                    defaults={
                        "doctor": request.user,
                        "patient": appointment.patient,
                        "diagnosis": diagnosis or "General Consultation Completed",
                        "symptoms": symptoms or "Reviewed during consultation",
                        "medications": medications or "As advised by doctor",
                        "notes": notes,
                    },
                )
            messages.success(
                request,
                f"Consultation with {appointment.patient.get_full_name()} (Serial #{appointment.serial_number}) marked as Completed."
            )
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("doctors:dashboard")


class AppointmentNoShowView(DoctorRequiredMixin, View):
    """Doctor marks appointment as No Show."""
    def post(self, request, pk):
        appointment = get_object_or_404(Booking, pk=pk, doctor=request.user)
        try:
            appointment.transition_to(Booking.StatusChoices.NO_SHOW, actor=request.user)
            messages.info(request, f"Appointment #{appointment.serial_number} marked as No Show.")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))
        return redirect("doctors:dashboard")


class AppointmentCancelView(LoginRequiredMixin, View):
    """Doctor or authorized staff cancels appointment with reason."""
    def post(self, request, pk):
        appointment = get_object_or_404(Booking, pk=pk)
        if not request.user.can_access_doctor(appointment.doctor):
            raise PermissionDenied("You are not authorized to cancel appointments for this doctor.")

        reason = request.POST.get("cancellation_reason", "").strip() or "Cancelled by doctor/clinic."
        try:
            appointment.transition_to(Booking.StatusChoices.CANCELLED, actor=request.user, reason=reason)
            messages.warning(request, f"Appointment #{appointment.serial_number} cancelled.")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("doctors:dashboard")


class DoctorPatientHistoryView(DoctorRequiredMixin, ListView):
    """
    Displays the complete regular visit and appointment history of a patient
    under the consulting doctor, including visit types, fees, and prescription records.
    """
    template_name = "doctors/patient_history.html"
    context_object_name = "appointments"
    paginate_by = 15

    def get_queryset(self):
        patient_id = self.kwargs.get("patient_id")
        self.patient = get_object_or_404(User, id=patient_id, role=User.RoleChoices.PATIENT)
        return (
            Booking.objects.filter(doctor=self.request.user, patient=self.patient)
            .select_related("prescription")
            .order_by("-appointment_date", "-appointment_time")
        )

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["patient"] = self.patient
        context["completed_regular_visits"] = self.get_queryset().filter(
            visit_type=Booking.VisitType.REGULAR,
            status=Booking.StatusChoices.COMPLETED,
        ).count()
        return context


class DoctorScheduleManageView(DoctorRequiredMixin, View):
    """
    Doctor schedule management engine:
    - Weekly recurring sessions: start/end time, duration, capacity, breaks, chamber.
    - Validates against overlapping sessions on the same weekday.
    - Safety: Checks if schedule deactivation/change affects existing appointments.
    """
    template_name = "doctors/schedule_manage.html"

    def get(self, request):
        doctor = request.user
        schedules = DoctorWeeklySchedule.objects.filter(doctor=doctor).prefetch_related("breaks").order_by("weekday", "start_time")
        exceptions = DoctorAvailabilityException.objects.filter(doctor=doctor).order_by("-start_date")
        context = {
            "schedules": schedules,
            "exceptions": exceptions,
            "weekday_choices": DoctorWeeklySchedule.WeekdayChoices.choices,
        }
        return render(request, self.template_name, context)

    def post(self, request):
        doctor = request.user
        action = request.POST.get("action", "add_session")

        if action == "add_session":
            weekday = int(request.POST.get("weekday", 0))
            session_name = request.POST.get("session_name", "Morning Session").strip()
            start_str = request.POST.get("start_time")
            end_str = request.POST.get("end_time")
            slot_duration = int(request.POST.get("slot_duration", 15))
            max_capacity = int(request.POST.get("max_capacity", 20))
            chamber = request.POST.get("chamber_number", "").strip() or getattr(doctor.profile, "chamber_number", "")

            try:
                start_time = datetime.strptime(start_str, "%H:%M").time()
                end_time = datetime.strptime(end_str, "%H:%M").time()
            except (ValueError, TypeError):
                messages.error(request, "Invalid time format.")
                return redirect("doctors:manage-schedules")

            if start_time >= end_time:
                messages.error(request, "Session start time must be earlier than end time.")
                return redirect("doctors:manage-schedules")

            # Check overlap safety
            if check_schedule_overlap(doctor, weekday, start_time, end_time):
                messages.error(
                    request,
                    f"Overlapping session detected! You already have an active session during {start_time.strftime('%I:%M %p')} - {end_time.strftime('%I:%M %p')} on this weekday."
                )
                return redirect("doctors:manage-schedules")

            sched = DoctorWeeklySchedule.objects.create(
                doctor=doctor,
                weekday=weekday,
                session_name=session_name,
                start_time=start_time,
                end_time=end_time,
                slot_duration=slot_duration,
                max_capacity=max_capacity,
                chamber_number=chamber,
                is_active=True,
            )

            # Optional break
            break_name = request.POST.get("break_name", "").strip()
            break_start_str = request.POST.get("break_start")
            break_end_str = request.POST.get("break_end")
            if break_start_str and break_end_str:
                try:
                    b_start = datetime.strptime(break_start_str, "%H:%M").time()
                    b_end = datetime.strptime(break_end_str, "%H:%M").time()
                    if start_time <= b_start < b_end <= end_time:
                        DoctorScheduleBreak.objects.create(
                            schedule=sched,
                            name=break_name or "Break",
                            start_time=b_start,
                            end_time=b_end,
                        )
                except ValueError:
                    pass

            messages.success(request, f"New weekly session '{session_name}' added successfully.")

        elif action == "toggle_session":
            session_id = request.POST.get("session_id")
            sched = get_object_or_404(DoctorWeeklySchedule, pk=session_id, doctor=doctor)
            sched.is_active = not sched.is_active
            sched.save()
            status_text = "activated" if sched.is_active else "deactivated"
            messages.info(request, f"Session '{sched.session_name}' has been {status_text}.")

        elif action == "delete_session":
            session_id = request.POST.get("session_id")
            sched = get_object_or_404(DoctorWeeklySchedule, pk=session_id, doctor=doctor)
            sched.delete()
            messages.success(request, f"Session '{sched.session_name}' deleted.")

        return redirect("doctors:manage-schedules")


class DoctorAvailabilityExceptionView(DoctorRequiredMixin, View):
    """
    Manage doctor availability exceptions:
    - Mark date as Not Available / Day Off
    - Block time intervals
    - Set holiday / temporary leave
    - Safety: Identifies affected bookings and requires explicit resolution without silent cancellation.
    """
    def post(self, request):
        doctor = request.user
        exception_type = request.POST.get("exception_type", "day_off")
        start_date_str = request.POST.get("start_date")
        end_date_str = request.POST.get("end_date") or start_date_str
        reason = request.POST.get("reason", "").strip()
        start_time_str = request.POST.get("start_time")
        end_time_str = request.POST.get("end_time")

        try:
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            messages.error(request, "Invalid date format.")
            return redirect("doctors:manage-schedules")

        start_time = None
        end_time = None
        if start_time_str and end_time_str:
            try:
                start_time = datetime.strptime(start_time_str, "%H:%M").time()
                end_time = datetime.strptime(end_time_str, "%H:%M").time()
            except ValueError:
                pass

        # Detect affected bookings across the exception period
        affected = []
        cur_d = start_date
        while cur_d <= end_date:
            affected.extend(detect_affected_appointments(doctor, cur_d, start_time, end_time))
            cur_d += timedelta(days=1)

        DoctorAvailabilityException.objects.create(
            doctor=doctor,
            exception_type=exception_type,
            start_date=start_date,
            end_date=end_date,
            start_time=start_time,
            end_time=end_time,
            reason=reason,
            is_active=True,
        )

        if affected:
            messages.warning(
                request,
                f"Exception recorded. NOTE: {len(affected)} existing appointment(s) fall within this period! Green Hospital never silently cancels appointments; please review and contact the patients to reschedule or cancel with approval."
            )
        else:
            messages.success(request, "Availability exception saved successfully.")

        return redirect("doctors:manage-schedules")


class DoctorSlotsJsonView(View):
    """
    API endpoint returning computed slots, 48-hour window status,
    and capacity statistics for a doctor on a specific date.
    """
    def get(self, request, username):
        doctor = get_object_or_404(User, username=username, role=User.RoleChoices.DOCTOR)
        date_str = request.GET.get("date")
        if not date_str:
            return JsonResponse({"error": "Date parameter required"}, status=400)

        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return JsonResponse({"error": "Invalid date format. Use YYYY-MM-DD"}, status=400)

        is_walk_in = request.user.is_authenticated and (request.user.is_receptionist or request.user.is_staff_admin)
        data = generate_doctor_slots(doctor, target_date, is_walk_in=is_walk_in)

        # JSON serialize time and datetime
        slots_payload = []
        for s in data["slots"]:
            slots_payload.append({
                "time": s["time_str"],
                "formatted_time": s["formatted_time"],
                "session_name": s["session_name"],
                "chamber": s["chamber"],
                "is_available": s["is_available"],
                "is_booked": s["is_booked"],
                "reason": s.get("reason"),
            })

        return JsonResponse({
            "doctor": doctor.username,
            "doctor_name": doctor.get_full_name(),
            "date": str(target_date),
            "is_available_date": data["is_available_date"],
            "reason": data.get("reason"),
            "max_capacity": data["max_capacity"],
            "booked_count": data["booked_count"],
            "remaining_capacity": data["remaining_capacity"],
            "is_full": data["is_full"],
            "slots": slots_payload,
        })


class MyPatientsView(DoctorRequiredMixin, ListView):
    template_name = "doctors/my-patients.html"
    context_object_name = "patients"

    def get_queryset(self):
        # Get unique patients who have appointments with this doctor
        return (
            User.objects.filter(
                patient_appointments__doctor=self.request.user, role="patient"
            )
            .distinct()
            .select_related("profile")
        )

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Get appointment counts for each patient
        patient_stats = {}
        for patient in context["patients"]:
            stats = Booking.objects.filter(
                doctor=self.request.user, patient=patient
            ).aggregate(
                total_appointments=Count("id"),
                completed_appointments=Count(
                    "id", filter=Q(status="completed")
                ),
            )
            patient_stats[patient.id] = stats
        context["patient_stats"] = patient_stats
        return context


class AppointmentHistoryView(DoctorRequiredMixin, ListView):
    model = Booking
    template_name = "doctors/appointment-history.html"
    context_object_name = "appointments"

    def get_queryset(self):
        return (
            self.model.objects.select_related("patient", "patient__profile")
            .filter(
                doctor=self.request.user, patient_id=self.kwargs["patient_id"]
            )
            .order_by("-appointment_date", "-appointment_time")
        )

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["patient"] = get_object_or_404(
            User.objects.select_related("profile"),
            id=self.kwargs["patient_id"],
            role="patient",
        )
        return context


class DoctorChangePasswordView(DoctorRequiredMixin, View):
    template_name = "doctors/change-password.html"

    def get(self, request, *args, **kwargs):
        return render(
            request, self.template_name, {"form": ChangePasswordForm()}
        )

    def post(self, request, *args, **kwargs):
        form = ChangePasswordForm(request.POST)
        if form.is_valid():
            user = request.user

            if user.check_password(form.cleaned_data["old_password"]):
                user.set_password(form.cleaned_data["new_password"])
                user.save()

                # Update session to prevent logout
                update_session_auth_hash(request, user)

                messages.success(request, "Password changed successfully")
                return redirect("doctors:dashboard")
            else:
                messages.error(request, "Current password is incorrect")

        return render(request, self.template_name, {"form": form})


class PrescriptionCreateView(DoctorRequiredMixin, CreateView):
    model = Prescription
    form_class = PrescriptionForm
    template_name = "doctors/add_prescription.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        booking_id = self.kwargs.get("booking_id")
        context["booking"] = get_object_or_404(
            Booking, id=booking_id, doctor=self.request.user
        )
        return context

    def form_valid(self, form):
        booking_id = self.kwargs.get("booking_id")
        booking = get_object_or_404(
            Booking, id=booking_id, doctor=self.request.user
        )

        if booking.status != "completed":
            messages.error(
                self.request,
                "Can only add prescription for completed appointments",
            )
            return redirect("doctors:appointment-detail", pk=booking_id)

        form.instance.booking = booking
        form.instance.doctor = self.request.user
        form.instance.patient = booking.patient
        messages.success(self.request, "Prescription added successfully")
        return super().form_valid(form)

    def get_success_url(self):
        return reverse_lazy(
            "doctors:appointment-detail",
            kwargs={"pk": self.kwargs["booking_id"]},
        )


class PrescriptionDetailView(DoctorRequiredMixin, DetailView):
    model = Prescription
    template_name = "doctors/prescription_detail.html"
    context_object_name = "prescription"

    def get_queryset(self):
        # Only allow doctors to view prescriptions they wrote
        return Prescription.objects.filter(
            doctor=self.request.user
        ).select_related(
            "doctor",
            "doctor__profile",
            "patient",
            "patient__profile",
            "booking",
        )
