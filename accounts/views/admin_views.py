from django.core.exceptions import PermissionDenied
from django.views.generic import TemplateView, View, DetailView
from django.db.models import Count, Sum, Avg
from accounts.decorators import AdminRequiredMixin, HospitalAdminRequiredMixin, RefundApprovalPermissionMixin
from django.views.generic import ListView
from datetime import date
from django.contrib import messages
from django.urls import reverse_lazy
from django.shortcuts import get_object_or_404, redirect
from django.views.generic.edit import CreateView, UpdateView, DeleteView
from django.db.models.functions import TruncMonth, TruncDay
from django.db.models import Count, Sum, Q
from django.utils import timezone
from datetime import timedelta
from django.core.serializers.json import DjangoJSONEncoder
import json
from decimal import Decimal

from core.models import Review, Speciality
from accounts.models import User
from bookings.models import Booking, Prescription


class AdminDashboardView(AdminRequiredMixin, TemplateView):
    template_name = "dashboard/index.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # Count statistics
        context["doctors_count"] = User.objects.filter(role="doctor").count()
        context["patients_count"] = User.objects.filter(role="patient").count()
        context["appointments_count"] = Booking.objects.count()

        # Calculate total revenue
        context["total_revenue"] = (
            Booking.objects.filter(status="completed").aggregate(
                total=Sum("doctor__profile__price_per_consultation")
            )["total"]
            or 0
        )

        # Get recent doctors with their stats
        doctors = User.objects.filter(role="doctor").select_related("profile")[:5]
        for doctor in doctors:
            doctor.earned = (
                Booking.objects.filter(doctor=doctor, status="completed").aggregate(
                    total=Sum("doctor__profile__price_per_consultation")
                )["total"]
                or 0
            )
            doctor.reviews_count = 0  # Add review logic when implemented
        context["recent_doctors"] = doctors

        # Get recent patients with their appointments
        patients = User.objects.filter(role="patient").select_related("profile")[:5]
        for patient in patients:
            latest_appointment = (
                Booking.objects.filter(patient=patient)
                .order_by("-appointment_date")
                .first()
            )
            patient.last_visit = (
                latest_appointment.appointment_date if latest_appointment else None
            )
            patient.total_paid = (
                Booking.objects.filter(patient=patient, status="completed").aggregate(
                    total=Sum("doctor__profile__price_per_consultation")
                )["total"]
                or 0
            )
        context["recent_patients"] = patients

        # Get recent appointments
        context["recent_appointments"] = Booking.objects.select_related(
            "doctor", "doctor__profile", "patient", "patient__profile"
        ).order_by("-appointment_date")[:5]

        # Add recent prescriptions
        context["recent_prescriptions"] = Prescription.objects.select_related(
            "doctor", "patient", "booking"
        ).order_by("-created_at")[:10]

        return context


class AdminPatientsView(AdminRequiredMixin, ListView):
    model = User
    template_name = "dashboard/patients.html"
    context_object_name = "patients"
    paginate_by = 10

    def get_queryset(self):
        queryset = User.objects.filter(role="patient").select_related("profile")

        # Add computed fields for each patient
        for patient in queryset:
            # Get last visit date
            latest_appointment = (
                Booking.objects.filter(patient=patient)
                .order_by("-appointment_date")
                .first()
            )
            patient.last_visit = (
                latest_appointment.appointment_date if latest_appointment else None
            )

            # Calculate total amount paid
            patient.total_paid = (
                Booking.objects.filter(patient=patient, status="completed").aggregate(
                    total=Sum("doctor__profile__price_per_consultation")
                )["total"]
                or 0
            )

            # Calculate age from DOB if available
            if patient.profile.dob:
                today = date.today()
                patient.profile.age = (
                    today.year
                    - patient.profile.dob.year
                    - (
                        (today.month, today.day)
                        < (patient.profile.dob.month, patient.profile.dob.day)
                    )
                )
            else:
                patient.profile.age = None

            # Get appointment stats
            patient.total_appointments = Booking.objects.filter(patient=patient).count()
            patient.completed_appointments = Booking.objects.filter(
                patient=patient, status="completed"
            ).count()

        return queryset


class AdminDoctorsView(AdminRequiredMixin, ListView):
    model = User
    template_name = "dashboard/doctors.html"
    context_object_name = "doctors"
    paginate_by = 10

    def get_queryset(self):
        return User.objects.filter(role="doctor")


class AdminAppointmentsView(AdminRequiredMixin, ListView):
    model = Booking
    template_name = "dashboard/appointments.html"
    context_object_name = "appointments"
    paginate_by = 10

    def get_queryset(self):
        return Booking.objects.select_related(
            "doctor", "doctor__profile", "patient", "patient__profile"
        ).order_by("-appointment_date", "-appointment_time")


class AdminSpecialitiesView(AdminRequiredMixin, ListView):
    model = Speciality
    template_name = "dashboard/specialities.html"
    context_object_name = "specialities"
    paginate_by = 10

    def get_queryset(self):
        return Speciality.objects.all().order_by("name")


class SpecialityCreateView(AdminRequiredMixin, CreateView):
    model = Speciality
    fields = ["name", "description", "image"]
    template_name = "dashboard/specialities.html"
    success_url = reverse_lazy("admin-specialities")

    def form_valid(self, form):
        messages.success(self.request, "Speciality created successfully.")
        return super().form_valid(form)


class SpecialityUpdateView(AdminRequiredMixin, UpdateView):
    model = Speciality
    fields = ["name", "description", "image", "is_active"]
    template_name = "dashboard/specialities.html"
    success_url = reverse_lazy("admin-specialities")

    def form_valid(self, form):
        messages.success(self.request, "Speciality updated successfully.")
        return super().form_valid(form)


class SpecialityDeleteView(AdminRequiredMixin, DeleteView):
    model = Speciality
    success_url = reverse_lazy("admin-specialities")

    def delete(self, request, *args, **kwargs):
        messages.success(request, "Speciality deleted successfully.")
        return super().delete(request, *args, **kwargs)


class AdminPrescriptionsView(AdminRequiredMixin, ListView):
    model = Prescription
    template_name = "dashboard/prescriptions.html"
    context_object_name = "prescriptions"
    paginate_by = 10

    def get_queryset(self):
        return Prescription.objects.select_related(
            "doctor",
            "doctor__profile",
            "patient",
            "patient__profile",
            "booking",
        ).order_by("-created_at")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Add summary stats
        context["total_prescriptions"] = self.model.objects.count()
        context["prescriptions_today"] = self.model.objects.filter(
            created_at__date=date.today()
        ).count()
        return context


class AdminReviewListView(AdminRequiredMixin, ListView):
    model = Review
    template_name = "dashboard/reviews.html"
    context_object_name = "reviews"
    paginate_by = 10

    def get_queryset(self):
        return Review.objects.select_related(
            "doctor",
            "doctor__profile",
            "patient",
            "patient__profile",
            "booking",
        ).order_by("-created_at")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["total_reviews"] = self.model.objects.count()
        context["average_rating"] = (
            self.model.objects.aggregate(Avg("rating"))["rating__avg"] or 0
        )
        return context


class AppointmentReportView(AdminRequiredMixin, TemplateView):
    template_name = "dashboard/reports/appointments.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # Get date range from query params or default to last 30 days
        end_date = timezone.now().date()
        start_date = end_date - timedelta(days=30)

        # Get appointments data
        appointments = Booking.objects.filter(
            appointment_date__range=[start_date, end_date]
        ).select_related("doctor", "patient")

        # Monthly trend
        monthly_stats = list(
            appointments.annotate(month=TruncMonth("appointment_date"))
            .values("month")
            .annotate(
                total=Count("id"),
                completed=Count("id", filter=Q(status="completed")),
                cancelled=Count("id", filter=Q(status="cancelled")),
            )
            .order_by("month")
        )

        # Format dates for JSON
        for stat in monthly_stats:
            stat["month"] = stat["month"].strftime("%Y-%m-%d")

        # Status distribution
        status_stats = list(appointments.values("status").annotate(count=Count("id")))

        # Doctor performance
        doctor_stats = list(
            appointments.values("doctor__first_name", "doctor__last_name").annotate(
                total=Count("id"),
                completed=Count("id", filter=Q(status="completed")),
                cancelled=Count("id", filter=Q(status="cancelled")),
            )
        )

        context.update(
            {
                "monthly_stats": json.dumps(monthly_stats),
                "status_stats": json.dumps(status_stats),
                "doctor_stats": doctor_stats,
                "total_appointments": appointments.count(),
                "completed_appointments": appointments.filter(
                    status="completed"
                ).count(),
                "cancelled_appointments": appointments.filter(
                    status="cancelled"
                ).count(),
            }
        )
        return context


class RevenueReportView(AdminRequiredMixin, TemplateView):
    template_name = "dashboard/reports/revenue.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # Add date filtering
        end_date = timezone.now().date()
        start_date = end_date - timedelta(days=30)

        completed_bookings = Booking.objects.filter(status="completed").select_related(
            "doctor__profile"
        )

        # Monthly revenue
        monthly_revenue = list(
            completed_bookings.annotate(month=TruncMonth("appointment_date"))
            .values("month")
            .annotate(revenue=Sum("doctor__profile__price_per_consultation"))
            .order_by("month")
        )

        # Format dates and convert Decimal to float for JSON
        for stat in monthly_revenue:
            stat["month"] = stat["month"].strftime("%Y-%m-%d")
            stat["revenue"] = float(stat["revenue"]) if stat["revenue"] else 0

        # Doctor revenue
        doctor_revenue = list(
            completed_bookings.values("doctor__first_name", "doctor__last_name")
            .annotate(
                revenue=Sum("doctor__profile__price_per_consultation"),
                appointments=Count("id"),
            )
            .order_by("-revenue")
        )

        # Convert Decimal to float for JSON
        for stat in doctor_revenue:
            stat["revenue"] = float(stat["revenue"]) if stat["revenue"] else 0

        # Add summary statistics
        context.update(
            {
                "total_appointments": completed_bookings.count(),
                "average_revenue_per_appointment": (
                    completed_bookings.aggregate(
                        avg=Avg("doctor__profile__price_per_consultation")
                    )["avg"]
                    or 0
                ),
                "highest_revenue_day": completed_bookings.annotate(
                    day=TruncDay("appointment_date")
                )
                .values("day")
                .annotate(total=Sum("doctor__profile__price_per_consultation"))
                .order_by("-total")
                .first(),
                "monthly_revenue_stats": json.dumps(monthly_revenue),
                "monthly_revenue": monthly_revenue,
                "doctor_revenue": doctor_revenue,
                "total_revenue": completed_bookings.aggregate(
                    total=Sum("doctor__profile__price_per_consultation")
                )["total"]
                or 0,
            }
        )

        # Add revenue by specialization
        # specialization_revenue = completed_bookings.values(
        #     "doctor__profile__specialization__name"
        # ).annotate(
        #     revenue=Sum("doctor__profile__price_per_consultation"),
        #     appointments=Count("id")
        # ).order_by("-revenue")

        context["specialization_revenue"] = 0  # specialization_revenue

        return context

from accounts.decorators import (
    SuperAdminRequiredMixin,
    HospitalAdminRequiredMixin,
    RefundApprovalPermissionMixin,
)
from accounts.models import (
    ReceptionistDoctorAssignment,
    AuditLog,
    log_audit_event,
)
from accounts.forms import (
    StaffRoleAssignmentForm,
    ReceptionistDoctorAssignmentForm,
)
from django.core.exceptions import PermissionDenied


class StaffManagementListView(SuperAdminRequiredMixin, ListView):
    """
    Restricted to Super Admin only.
    Manage staff accounts and privileged role assignments.
    """
    model = User
    template_name = "dashboard/staff_management.html"
    context_object_name = "staff_members"

    def get_queryset(self):
        return User.objects.filter(
            role__in=[
                User.RoleChoices.SUPER_ADMIN,
                User.RoleChoices.HOSPITAL_ADMIN,
                User.RoleChoices.RECEPTIONIST,
            ]
        ).order_by("-date_joined")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["all_users"] = User.objects.all().order_by("username")
        context["role_choices"] = User.RoleChoices.choices
        context["status_choices"] = User.StatusChoices.choices
        return context


class StaffRoleChangeView(SuperAdminRequiredMixin, View):
    """
    Restricted to Super Admin only.
    Promotes or updates roles of users to privileged staff positions with audit logging.
    """
    def post(self, request, pk):
        target_user = get_object_or_404(User, pk=pk)
        new_role = request.POST.get("role")
        new_status = request.POST.get("status")

        old_role = target_user.role
        old_status = target_user.status

        if new_role and new_role in dict(User.RoleChoices.choices):
            target_user.role = new_role
            if new_role in [User.RoleChoices.SUPER_ADMIN, User.RoleChoices.HOSPITAL_ADMIN]:
                target_user.is_staff = True
            if new_role == User.RoleChoices.SUPER_ADMIN:
                target_user.is_superuser = True

        if new_status and new_status in dict(User.StatusChoices.choices):
            target_user.status = new_status
            if new_status == User.StatusChoices.SUSPENDED:
                target_user.is_active = False
            elif new_status == User.StatusChoices.ACTIVE:
                target_user.is_active = True

        target_user.save()

        # Audit logging
        if old_role != target_user.role:
            log_audit_event(
                actor=request.user,
                action=AuditLog.ActionChoices.ROLE_CHANGE,
                target_user=target_user,
                details={"old_role": old_role, "new_role": target_user.role},
                ip_address=request.META.get("REMOTE_ADDR"),
            )
        if old_status != target_user.status:
            log_audit_event(
                actor=request.user,
                action=AuditLog.ActionChoices.STATUS_CHANGE,
                target_user=target_user,
                details={"old_status": old_status, "new_status": target_user.status},
                ip_address=request.META.get("REMOTE_ADDR"),
            )

        messages.success(request, f"Updated role/status for {target_user.username}")
        return redirect("admin-staff-management")


class ReceptionistAssignmentListView(HospitalAdminRequiredMixin, ListView):
    """
    Hospital Administrator and Super Admin view to inspect and manage
    assignments between receptionists and doctors.
    """
    model = ReceptionistDoctorAssignment
    template_name = "dashboard/receptionist_assignments.html"
    context_object_name = "assignments"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["receptionists"] = User.objects.filter(
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )
        context["doctors"] = User.objects.filter(
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
        )
        return context


class ReceptionistAssignDoctorView(HospitalAdminRequiredMixin, View):
    """
    Assign a receptionist to a doctor.
    Accessible to Hospital Admin and Super Admin.
    """
    def post(self, request):
        receptionist_id = request.POST.get("receptionist_id")
        doctor_id = request.POST.get("doctor_id")

        receptionist = get_object_or_404(
            User, pk=receptionist_id, role=User.RoleChoices.RECEPTIONIST
        )
        doctor = get_object_or_404(
            User, pk=doctor_id, role=User.RoleChoices.DOCTOR
        )

        assignment, created = ReceptionistDoctorAssignment.objects.get_or_create(
            receptionist=receptionist,
            doctor=doctor,
            defaults={"assigned_by": request.user},
        )

        if created:
            log_audit_event(
                actor=request.user,
                action=AuditLog.ActionChoices.RECEPTIONIST_ASSIGNED,
                target_user=receptionist,
                details={"doctor": doctor.username, "doctor_id": doctor.id},
                ip_address=request.META.get("REMOTE_ADDR"),
            )
            messages.success(
                request,
                f"Assigned receptionist {receptionist.username} to Dr. {doctor.get_full_name()}."
            )
        else:
            messages.info(request, "This assignment already exists.")

        return redirect("admin-receptionist-assignments")


class ReceptionistUnassignDoctorView(HospitalAdminRequiredMixin, View):
    """
    Remove an existing receptionist-doctor assignment.
    """
    def post(self, request, pk):
        assignment = get_object_or_404(ReceptionistDoctorAssignment, pk=pk)
        receptionist = assignment.receptionist
        doctor = assignment.doctor

        assignment.delete()

        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.RECEPTIONIST_REMOVED,
            target_user=receptionist,
            details={"doctor": doctor.username, "doctor_id": doctor.id},
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        messages.success(
            request,
            f"Removed assignment of {receptionist.username} from Dr. {doctor.get_full_name()}."
        )
        return redirect("admin-receptionist-assignments")


class AuditLogListView(HospitalAdminRequiredMixin, ListView):
    """
    View audit logs across all sensitive role changes, status updates,
    and administrative assignments.
    """
    model = AuditLog
    template_name = "dashboard/audit_logs.html"
    context_object_name = "audit_logs"
    paginate_by = 25

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor", "target_user").all()
        action = self.request.GET.get("action")
        if action:
            qs = qs.filter(action=action)
        return qs

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["actions"] = AuditLog.ActionChoices.choices
        context["selected_action"] = self.request.GET.get("action", "")
        return context


class RefundApprovalView(RefundApprovalPermissionMixin, View):
    """
    Refund approval authorization check.
    Only Super Admin has authority to approve refunds.
    Hospital Administrators cannot approve refunds (raises PermissionDenied).
    """
    def post(self, request, booking_id):
        # Explicit check
        if not request.user.can_approve_refunds:
            raise PermissionDenied(
                "Hospital Administrators cannot approve refunds. Final refund approval is strictly reserved for Super Administrators."
            )
        booking = get_object_or_404(Booking, pk=booking_id)
        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.REFUND_ACTION,
            target_user=booking.patient,
            details={"booking_id": booking.id, "action": "refund_approved"},
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        messages.success(request, f"Refund for appointment #{booking.id} approved by Super Admin.")
        return redirect("admin-appointments")


class DoctorApprovalListView(HospitalAdminRequiredMixin, ListView):
    """
    Hospital Administrator and Super Admin dashboard to review and manage doctor registrations.
    Filters by status: pending_approval, active, suspended, rejected.
    """
    model = User
    template_name = "dashboard/doctor_approvals.html"
    context_object_name = "doctors"
    paginate_by = 15

    def get_queryset(self):
        qs = User.objects.filter(role=User.RoleChoices.DOCTOR).select_related("profile").prefetch_related("educations").order_by("-date_joined")
        status_filter = self.request.GET.get("status")
        if status_filter in dict(User.StatusChoices.choices):
            qs = qs.filter(status=status_filter)
        q = self.request.GET.get("q")
        if q:
            qs = qs.filter(
                Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(username__icontains=q)
                | Q(bmdc_number__icontains=q)
                | Q(profile__department__icontains=q)
            )
        return qs

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["selected_status"] = self.request.GET.get("status", "")
        context["status_choices"] = User.StatusChoices.choices
        context["pending_count"] = User.objects.filter(
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
        ).count()
        return context


class DoctorApprovalDetailView(HospitalAdminRequiredMixin, DetailView):
    """
    Detailed view of a doctor's credentials, qualifications, contact info,
    and BMDC registration for admin review.
    """
    model = User
    template_name = "dashboard/doctor_approval_detail.html"
    context_object_name = "doctor"

    def get_queryset(self):
        return User.objects.filter(role=User.RoleChoices.DOCTOR).select_related("profile").prefetch_related("educations", "experiences")


class DoctorApproveActionView(HospitalAdminRequiredMixin, View):
    """
    Approve a pending doctor registration.
    Only Hospital Admin or Super Admin can approve registrations.
    Server-side enforcement: Doctors cannot approve themselves.
    """
    def post(self, request, pk):
        doctor = get_object_or_404(User, pk=pk, role=User.RoleChoices.DOCTOR)
        if request.user.id == doctor.id:
            raise PermissionDenied("Doctors cannot approve themselves.")

        old_status = doctor.status
        doctor.status = User.StatusChoices.ACTIVE
        doctor.is_active = True
        doctor.approved_by = request.user
        doctor.approved_at = timezone.now()
        doctor.rejection_reason = ""
        doctor.save()

        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.DOCTOR_APPROVED,
            target_user=doctor,
            details={
                "old_status": old_status,
                "new_status": doctor.status,
                "approved_by": request.user.username,
            },
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        messages.success(request, f"Dr. {doctor.get_full_name()} has been successfully approved.")
        return redirect("admin-doctor-approvals")


class DoctorRejectActionView(HospitalAdminRequiredMixin, View):
    """
    Reject a doctor registration with reason.
    Server-side enforcement: Doctors cannot reject themselves.
    """
    def post(self, request, pk):
        doctor = get_object_or_404(User, pk=pk, role=User.RoleChoices.DOCTOR)
        if request.user.id == doctor.id:
            raise PermissionDenied("Doctors cannot reject themselves.")

        reason = request.POST.get("rejection_reason", "").strip() or "Credentials could not be verified."
        old_status = doctor.status
        doctor.status = User.StatusChoices.REJECTED
        doctor.rejection_reason = reason
        doctor.save()

        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.DOCTOR_REJECTED,
            target_user=doctor,
            details={
                "old_status": old_status,
                "new_status": doctor.status,
                "rejection_reason": reason,
            },
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        messages.warning(request, f"Registration for Dr. {doctor.get_full_name()} has been rejected.")
        return redirect("admin-doctor-approvals")


class DoctorSuspendReactivateView(HospitalAdminRequiredMixin, View):
    """
    Suspend or reactivate a doctor account.
    Server-side enforcement: Doctors cannot suspend themselves.
    """
    def post(self, request, pk, action):
        doctor = get_object_or_404(User, pk=pk, role=User.RoleChoices.DOCTOR)
        if request.user.id == doctor.id:
            raise PermissionDenied("Doctors cannot modify their own suspension status.")

        old_status = doctor.status
        if action == "suspend":
            doctor.status = User.StatusChoices.SUSPENDED
            doctor.is_active = False
            audit_action = AuditLog.ActionChoices.DOCTOR_SUSPENDED
            msg = f"Dr. {doctor.get_full_name()} has been suspended."
        elif action == "reactivate":
            doctor.status = User.StatusChoices.ACTIVE
            doctor.is_active = True
            audit_action = AuditLog.ActionChoices.DOCTOR_REACTIVATED
            msg = f"Dr. {doctor.get_full_name()} has been reactivated."
        else:
            messages.error(request, "Invalid action specified.")
            return redirect("admin-doctor-approvals")

        doctor.save()

        log_audit_event(
            actor=request.user,
            action=audit_action,
            target_user=doctor,
            details={"old_status": old_status, "new_status": doctor.status},
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        messages.info(request, msg)
        return redirect("admin-doctor-approvals")


class DoctorBMDCVerifyActionView(HospitalAdminRequiredMixin, View):
    """
    Manual BMDC verification by hospital administrator.
    Does not claim automated integration; explicitly records manual verification by authorized admin.
    """
    def post(self, request, pk):
        doctor = get_object_or_404(User, pk=pk, role=User.RoleChoices.DOCTOR)
        if request.user.id == doctor.id:
            raise PermissionDenied("Doctors cannot verify their own BMDC credentials.")

        doctor.bmdc_verified = True
        doctor.bmdc_verified_by = request.user
        doctor.bmdc_verified_at = timezone.now()
        doctor.save()

        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.BMDC_VERIFIED,
            target_user=doctor,
            details={
                "bmdc_number": doctor.bmdc_number,
                "verified_by": request.user.username,
                "verification_mode": "manual_administrative_check",
            },
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        messages.success(
            request,
            f"BMDC Registration ({doctor.bmdc_number}) for Dr. {doctor.get_full_name()} verified manually."
        )
        return redirect("admin-doctor-approvals")
