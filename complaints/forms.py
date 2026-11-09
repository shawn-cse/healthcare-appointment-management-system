from django import forms
from accounts.models import User
from bookings.models import Booking
from complaints.models import Complaint


class PatientComplaintForm(forms.ModelForm):
    """
    Form for patients to submit complaints against doctors.
    """
    doctor = forms.ModelChoiceField(
        queryset=User.objects.filter(role=User.RoleChoices.DOCTOR, status=User.StatusChoices.ACTIVE),
        empty_label="Select a Doctor",
        widget=forms.Select(attrs={"class": "form-control"}),
        label="Doctor",
    )
    booking = forms.ModelChoiceField(
        queryset=Booking.objects.none(),
        required=False,
        empty_label="Select Related Appointment (Optional)",
        widget=forms.Select(attrs={"class": "form-control"}),
        label="Related Appointment",
    )

    class Meta:
        model = Complaint
        fields = ["doctor", "booking", "category", "subject", "description"]
        widgets = {
            "category": forms.Select(attrs={"class": "form-control"}),
            "subject": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "Brief summary of the issue (e.g. 1 hour delay without notice)",
            }),
            "description": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 5,
                "placeholder": "Please provide a detailed factual description of what occurred...",
            }),
        }

    def __init__(self, *args, **kwargs):
        patient = kwargs.pop("patient", None)
        super().__init__(*args, **kwargs)
        if patient:
            self.fields["booking"].queryset = Booking.objects.filter(
                patient=patient
            ).order_by("-appointment_date")


class AdminComplaintReviewForm(forms.ModelForm):
    """
    Form for Hospital Administrators and Super Admins to review and resolve complaints.
    """
    class Meta:
        model = Complaint
        fields = ["status", "admin_response", "admin_notes"]
        widgets = {
            "status": forms.Select(attrs={"class": "form-control"}),
            "admin_response": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 4,
                "placeholder": "Official resolution or feedback visible to the patient...",
            }),
            "admin_notes": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 3,
                "placeholder": "Confidential internal administration notes...",
            }),
        }
