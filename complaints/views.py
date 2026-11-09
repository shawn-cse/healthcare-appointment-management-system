from django.shortcuts import render, get_object_or_404, redirect
from django.views import View
from django.views.generic import ListView, DetailView, CreateView
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.contrib import messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.urls import reverse_lazy, reverse

from accounts.models import User
from bookings.models import Booking
from complaints.models import Complaint
from complaints.forms import PatientComplaintForm, AdminComplaintReviewForm
from complaints.services import submit_complaint, review_complaint


class PatientRequiredMixin(LoginRequiredMixin, UserPassesTestMixin):
    def test_func(self):
        return self.request.user.is_authenticated and self.request.user.role == User.RoleChoices.PATIENT

    def handle_no_permission(self):
        if self.request.user.is_authenticated:
            raise PermissionDenied("Only patients can access this area.")
        return super().handle_no_permission()


class AdminRequiredMixin(LoginRequiredMixin, UserPassesTestMixin):
    def test_func(self):
        return (
            self.request.user.is_authenticated
            and (self.request.user.is_super_admin or self.request.user.is_hospital_admin)
        )

    def handle_no_permission(self):
        if self.request.user.is_authenticated:
            raise PermissionDenied("Access restricted to Hospital Administrators and Super Admins.")
        return super().handle_no_permission()


# ==============================================================================
# Patient Complaint Views
# ==============================================================================

class PatientComplaintCreateView(PatientRequiredMixin, View):
    """
    Structured patient complaint form against a doctor.
    """
    template_name = "complaints/patient_complaint_form.html"

    def get(self, request):
        initial = {}
        doctor_id = request.GET.get("doctor_id")
        booking_id = request.GET.get("booking_id")

        if doctor_id:
            try:
                doc = User.objects.get(id=doctor_id, role=User.RoleChoices.DOCTOR)
                initial["doctor"] = doc
            except User.DoesNotExist:
                pass

        if booking_id:
            try:
                b = Booking.objects.get(id=booking_id, patient=request.user)
                initial["booking"] = b
                initial["doctor"] = b.doctor
            except Booking.DoesNotExist:
                pass

        form = PatientComplaintForm(patient=request.user, initial=initial)
        return render(request, self.template_name, {"form": form})

    def post(self, request):
        form = PatientComplaintForm(request.POST, patient=request.user)
        if form.is_valid():
            doctor = form.cleaned_data["doctor"]
            category = form.cleaned_data["category"]
            subject = form.cleaned_data["subject"]
            description = form.cleaned_data["description"]
            booking = form.cleaned_data.get("booking")

            try:
                complaint = submit_complaint(
                    patient=request.user,
                    doctor=doctor,
                    category=category,
                    subject=subject,
                    description=description,
                    booking=booking,
                    request=request,
                )
                messages.success(
                    request,
                    f"Your complaint has been submitted successfully (Reference: {complaint.reference}). "
                    f"Hospital Administration will review it shortly."
                )
                return redirect("complaints:patient-detail", pk=complaint.pk)
            except ValidationError as e:
                messages.error(request, e.message if hasattr(e, "message") else str(e))
            except Exception as e:
                messages.error(request, f"Could not submit complaint: {e}")

        return render(request, self.template_name, {"form": form})


class PatientComplaintListView(PatientRequiredMixin, ListView):
    """
    Lists only complaints filed by the active patient.
    """
    model = Complaint
    template_name = "complaints/patient_complaint_list.html"
    context_object_name = "complaints"
    paginate_by = 15

    def get_queryset(self):
        return Complaint.objects.filter(patient=self.request.user).select_related("doctor", "booking")


class PatientComplaintDetailView(PatientRequiredMixin, DetailView):
    """
    Detail view of a specific complaint filed by the active patient.
    """
    model = Complaint
    template_name = "complaints/patient_complaint_detail.html"
    context_object_name = "complaint"

    def get_queryset(self):
        # Strict privacy: patient can ONLY see their own complaint
        return Complaint.objects.filter(patient=self.request.user).select_related(
            "doctor", "booking", "reviewed_by"
        )


# ==============================================================================
# Administrator Complaint Management Views
# ==============================================================================

class AdminComplaintListView(AdminRequiredMixin, ListView):
    """
    Hospital Administrator & Super Admin oversight of all patient complaints.
    """
    model = Complaint
    template_name = "complaints/admin_complaint_list.html"
    context_object_name = "complaints"
    paginate_by = 25

    def get_queryset(self):
        qs = Complaint.objects.select_related("patient", "doctor", "booking", "reviewed_by")
        status_filter = self.request.GET.get("status")
        category_filter = self.request.GET.get("category")
        doctor_id = self.request.GET.get("doctor_id")

        if status_filter:
            qs = qs.filter(status=status_filter)
        if category_filter:
            qs = qs.filter(category=category_filter)
        if doctor_id:
            qs = qs.filter(doctor_id=doctor_id)

        return qs

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["status_choices"] = Complaint.StatusChoices.choices
        ctx["category_choices"] = Complaint.CategoryChoices.choices
        ctx["doctors"] = User.objects.filter(role=User.RoleChoices.DOCTOR).order_by("first_name")
        ctx["active_status"] = self.request.GET.get("status", "")
        ctx["active_category"] = self.request.GET.get("category", "")
        ctx["active_doctor"] = self.request.GET.get("doctor_id", "")
        ctx["counts"] = {
            "all": Complaint.objects.count(),
            "submitted": Complaint.objects.filter(status=Complaint.StatusChoices.SUBMITTED).count(),
            "under_review": Complaint.objects.filter(status=Complaint.StatusChoices.UNDER_REVIEW).count(),
            "resolved": Complaint.objects.filter(status=Complaint.StatusChoices.RESOLVED).count(),
            "rejected": Complaint.objects.filter(status=Complaint.StatusChoices.REJECTED).count(),
        }
        return ctx


class AdminComplaintReviewView(AdminRequiredMixin, View):
    """
    Review, investigate, respond, and change complaint status.
    """
    template_name = "complaints/admin_complaint_review.html"

    def get(self, request, pk):
        complaint = get_object_or_404(
            Complaint.objects.select_related("patient", "doctor", "booking", "reviewed_by"),
            pk=pk,
        )
        form = AdminComplaintReviewForm(instance=complaint)
        return render(request, self.template_name, {
            "complaint": complaint,
            "form": form,
        })

    def post(self, request, pk):
        complaint = get_object_or_404(Complaint, pk=pk)
        form = AdminComplaintReviewForm(request.POST, instance=complaint)
        if form.is_valid():
            new_status = form.cleaned_data["status"]
            admin_notes = form.cleaned_data.get("admin_notes", "")
            admin_response = form.cleaned_data.get("admin_response", "")

            try:
                review_complaint(
                    complaint=complaint,
                    admin_user=request.user,
                    new_status=new_status,
                    admin_notes=admin_notes,
                    admin_response=admin_response,
                    request=request,
                )
                messages.success(
                    request,
                    f"Complaint {complaint.reference} status updated to '{complaint.get_status_display()}'."
                )
                return redirect("complaints:admin-review", pk=complaint.pk)
            except Exception as e:
                messages.error(request, f"Error reviewing complaint: {e}")

        return render(request, self.template_name, {
            "complaint": complaint,
            "form": form,
        })
