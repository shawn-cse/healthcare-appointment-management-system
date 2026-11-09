from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse_lazy
from django.views.generic import UpdateView, DetailView, View, CreateView
from django.views.generic.base import TemplateView
from django.contrib import messages
from django.template.loader import render_to_string
from django.http import HttpResponse
from django.contrib.auth import update_session_auth_hash


from accounts.models import User
from bookings.models import Booking
from mixins.custom_mixins import PatientRequiredMixin
from patients.forms import PatientProfileForm, ChangePasswordForm, ReviewForm
from core.models import Review


class PatientDashboardView(PatientRequiredMixin, TemplateView):
    template_name = "patients/dashboard.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        user = self.request.user
        from payments.models import RefundRequest
        from complaints.models import Complaint

        context["appointments"] = (
            Booking.objects.select_related("doctor", "doctor__profile")
            .filter(patient=user)
            .order_by("-appointment_date", "-appointment_time")
        )
        context["refund_requests"] = RefundRequest.objects.filter(
            patient=user
        ).select_related("booking", "doctor").order_by("-created_at")
        context["complaints"] = Complaint.objects.filter(
            patient=user
        ).select_related("doctor").order_by("-created_at")
        return context


class PatientProfileUpdateView(PatientRequiredMixin, UpdateView):
    model = User
    template_name = "patients/profile-setting.html"
    success_url = reverse_lazy("patients:profile-setting")
    form_class = PatientProfileForm

    def get_object(self, queryset=None):
        return self.request.user

    def form_valid(self, form):
        user = form.save(commit=False)
        profile = user.profile

        # Handle profile image upload
        if self.request.FILES.get("avatar"):
            profile.image = self.request.FILES["avatar"]

        # Update profile fields
        profile_fields = [
            "dob",
            "blood_group",
            "gender",
            "phone",
            "medical_conditions",
            "allergies",
            "address",
            "city",
            "state",
            "postal_code",
            "country",
        ]

        for field in profile_fields:
            value = self.request.POST.get(field)
            if value:
                setattr(profile, field, value)

        # Save both user and profile
        user.save()
        profile.save()

        messages.success(self.request, "Profile updated successfully")
        return redirect(self.success_url)

    def form_invalid(self, form):
        messages.error(self.request, "Please correct the errors below")
        return super().form_invalid(form)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["blood_group_choices"] = [
            ("A+", "A+"),
            ("A-", "A-"),
            ("B+", "B+"),
            ("B-", "B-"),
            ("O+", "O+"),
            ("O-", "O-"),
            ("AB+", "AB+"),
            ("AB-", "AB-"),
        ]
        return context


class AppointmentDetailView(PatientRequiredMixin, DetailView):
    model = Booking
    template_name = "patients/appointment-detail.html"
    context_object_name = "appointment"

    def get_queryset(self):
        return Booking.objects.select_related(
            "doctor", "doctor__profile", "patient", "patient__profile"
        ).filter(patient=self.request.user)


from django.utils import timezone
from payments.services.refund_service import create_refund_request


class AppointmentCancelView(PatientRequiredMixin, View):
    def post(self, request, pk):
        appointment = get_object_or_404(
            Booking,
            pk=pk,
            patient=request.user,
            status__in=["pending", "confirmed"],
        )

        reason = request.POST.get("reason", "").strip() or "Cancelled by patient."
        appointment.transition_to(Booking.StatusChoices.CANCELLED, actor=request.user, reason=reason)

        # Process refund eligibility under strict financial policy
        if appointment.payment_status in (Booking.PaymentStatus.PAID, Booking.PaymentStatus.PARTIALLY_REFUNDED):
            refund_req = create_refund_request(
                booking=appointment,
                patient=request.user,
                reason=reason,
                cancellation_type="patient",
                current_time=timezone.now(),
                actor=request.user,
            )
            if refund_req:
                pct = refund_req.eligible_refund_percentage
                if pct == 100:
                    messages.success(
                        request,
                        f"Appointment cancelled. A 100% refund request (#{refund_req.refund_reference}) of {refund_req.requested_amount} BDT has been created."
                    )
                elif pct == 80:
                    messages.warning(
                        request,
                        f"Appointment cancelled less than 24h before start. An 80% refund request (#{refund_req.refund_reference}) of {refund_req.requested_amount} BDT has been created (20% cancellation fee deducted)."
                    )
                else:
                    messages.warning(
                        request,
                        f"Appointment cancelled at or after start. Refund request (#{refund_req.refund_reference}) forwarded for administrative exception review."
                    )
                return redirect("payments:refund-detail", refund_reference=refund_req.refund_reference)
            else:
                messages.info(request, "Appointment cancelled. No monetary refund is applicable under policy.")
        else:
            messages.success(request, "Appointment cancelled successfully. Since no payment was made, no refund was required.")

        return redirect("patients:dashboard")


class AppointmentPrintView(PatientRequiredMixin, DetailView):
    model = Booking
    template_name = "patients/appointment-print.html"
    context_object_name = "appointment"

    def get_queryset(self):
        return Booking.objects.select_related(
            "doctor", "doctor__profile", "patient", "patient__profile"
        ).filter(patient=self.request.user)

    def render_to_response(self, context):
        html_string = render_to_string(
            self.template_name, context, request=self.request
        )
        return HttpResponse(html_string)


class ChangePasswordView(PatientRequiredMixin, View):
    template_name = "patients/change-password.html"

    def get(self, request):
        form = ChangePasswordForm()
        return render(request, self.template_name, {"form": form})

    def post(self, request):
        form = ChangePasswordForm(request.POST)
        if form.is_valid():
            user = request.user

            if user.check_password(form.cleaned_data["old_password"]):
                user.set_password(form.cleaned_data["new_password"])
                user.save()

                # Update session to prevent logout
                update_session_auth_hash(request, user)

                messages.success(request, "Password changed successfully")
                return redirect("patients:dashboard")
            else:
                messages.error(request, "Current password is incorrect")

        return render(request, self.template_name, {"form": form})


class AddReviewView(PatientRequiredMixin, CreateView):
    model = Review
    form_class = ReviewForm
    template_name = "patients/add_review.html"

    def form_valid(self, form):
        booking_id = self.kwargs.get("booking_id")
        booking = get_object_or_404(
            Booking, id=booking_id, patient=self.request.user
        )

        if booking.status != "completed":
            messages.error(
                self.request, "You can only review completed appointments."
            )
            return redirect("patients:appointment-detail", pk=booking_id)

        if Review.objects.filter(booking=booking).exists():
            messages.error(
                self.request, "You have already reviewed this appointment."
            )
            return redirect("patients:appointment-detail", pk=booking_id)

        form.instance.patient = self.request.user
        form.instance.doctor = booking.doctor
        form.instance.booking = booking
        messages.success(self.request, "Thank you for your review!")
        return super().form_valid(form)

    def get_success_url(self):
        return reverse_lazy(
            "patients:appointment-detail",
            kwargs={"pk": self.kwargs["booking_id"]},
        )
