from decimal import Decimal
from django import forms
from accounts.models import User, Profile, DoctorFeeHistory, AuditLog, log_audit_event
from bookings.models import Prescription
from ckeditor.widgets import CKEditorWidget


class DoctorProfileForm(forms.ModelForm):
    """
    Doctor profile settings form for Green Hospital.
    Allows approved doctors to manage public details, office phone, chamber,
    and 4-tier consultation fees in BDT.
    If BMDC registration number is altered, account reverts to PENDING_APPROVAL
    and bmdc_verified is reset, requiring administrative re-verification.
    """
    phone = forms.CharField(max_length=20, required=False, label="Personal Phone")
    office_phone = forms.CharField(max_length=30, required=False, label="Office / Reception Phone")
    about = forms.CharField(widget=forms.Textarea(attrs={"rows": 4}), required=False)
    specialization = forms.CharField(max_length=255, required=False)
    chamber_number = forms.CharField(max_length=100, required=False, label="Chamber / Room Number")
    gender = forms.ChoiceField(
        choices=[("male", "Male"), ("female", "Female"), ("other", "Other")],
        required=False,
    )
    address = forms.CharField(widget=forms.Textarea(attrs={"rows": 2}), required=False)
    city = forms.CharField(max_length=100, required=False)
    state = forms.CharField(max_length=100, required=False)
    postal_code = forms.CharField(max_length=20, required=False)
    country = forms.CharField(max_length=100, required=False)

    # 4-Tier BDT Consultation Fees
    fee_first_visit = forms.DecimalField(
        max_digits=10, decimal_places=2, required=True, label="1st Regular Visit Fee (BDT)"
    )
    fee_second_visit = forms.DecimalField(
        max_digits=10, decimal_places=2, required=True, label="2nd Regular Visit Fee (BDT)"
    )
    fee_third_visit = forms.DecimalField(
        max_digits=10, decimal_places=2, required=True, label="3rd Regular Visit Fee (BDT)"
    )
    fee_report_check = forms.DecimalField(
        max_digits=10, decimal_places=2, required=True, label="Report Checking Fee (BDT)"
    )

    class Meta:
        model = User
        fields = [
            "first_name",
            "last_name",
            "email",
            "bmdc_number",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and hasattr(self.instance, "profile"):
            prof = self.instance.profile
            self.fields["phone"].initial = prof.phone
            self.fields["office_phone"].initial = prof.office_phone
            self.fields["about"].initial = prof.about
            self.fields["specialization"].initial = prof.specialization
            self.fields["chamber_number"].initial = prof.chamber_number
            self.fields["gender"].initial = prof.gender
            self.fields["address"].initial = prof.address
            self.fields["city"].initial = prof.city
            self.fields["state"].initial = prof.state
            self.fields["postal_code"].initial = prof.postal_code
            self.fields["country"].initial = prof.country
            self.fields["fee_first_visit"].initial = prof.fee_first_visit
            self.fields["fee_second_visit"].initial = prof.fee_second_visit
            self.fields["fee_third_visit"].initial = prof.fee_third_visit
            self.fields["fee_report_check"].initial = prof.fee_report_check

        for field in self.fields.values():
            if not isinstance(field.widget, forms.CheckboxInput):
                existing_class = field.widget.attrs.get("class", "")
                field.widget.attrs["class"] = f"{existing_class} form-control".strip()

    def clean_bmdc_number(self):
        new_bmdc = self.cleaned_data.get("bmdc_number", "").strip()
        if not new_bmdc:
            raise forms.ValidationError("BMDC registration number cannot be blank.")
        existing = User.objects.filter(bmdc_number__iexact=new_bmdc).exclude(pk=self.instance.pk)
        if existing.exists():
            raise forms.ValidationError("Another doctor is already registered with this BMDC number.")
        return new_bmdc

    def save(self, commit=True):
        user = super().save(commit=False)
        old_user = User.objects.get(pk=user.pk) if user.pk else None
        bmdc_changed = old_user and old_user.bmdc_number != user.bmdc_number

        # Important: changes to BMDC registration number require administrative re-verification
        if bmdc_changed:
            user.bmdc_verified = False
            user.status = User.StatusChoices.PENDING_APPROVAL

        if commit:
            user.save()
            prof = user.profile
            prof.phone = self.cleaned_data.get("phone")
            prof.office_phone = self.cleaned_data.get("office_phone")
            prof.about = self.cleaned_data.get("about")
            prof.specialization = self.cleaned_data.get("specialization")
            prof.chamber_number = self.cleaned_data.get("chamber_number")
            prof.gender = self.cleaned_data.get("gender")
            prof.address = self.cleaned_data.get("address")
            prof.city = self.cleaned_data.get("city")
            prof.state = self.cleaned_data.get("state")
            prof.postal_code = self.cleaned_data.get("postal_code")
            prof.country = self.cleaned_data.get("country")

            new_fee1 = self.cleaned_data.get("fee_first_visit")
            new_fee2 = self.cleaned_data.get("fee_second_visit")
            new_fee3 = self.cleaned_data.get("fee_third_visit")
            new_fee_report = self.cleaned_data.get("fee_report_check")

            fee_changed = (
                prof.fee_first_visit != new_fee1
                or prof.fee_second_visit != new_fee2
                or prof.fee_third_visit != new_fee3
                or prof.fee_report_check != new_fee_report
            )

            prof.fee_first_visit = new_fee1
            prof.fee_second_visit = new_fee2
            prof.fee_third_visit = new_fee3
            prof.fee_report_check = new_fee_report
            prof.save()

            if fee_changed:
                DoctorFeeHistory.objects.create(
                    doctor=user,
                    changed_by=user,
                    fee_first_visit=new_fee1,
                    fee_second_visit=new_fee2,
                    fee_third_visit=new_fee3,
                    fee_report_check=new_fee_report,
                )
                log_audit_event(
                    actor=user,
                    action=AuditLog.ActionChoices.FEE_CHANGED,
                    target_user=user,
                    details={
                        "fee_first_visit": str(new_fee1),
                        "fee_second_visit": str(new_fee2),
                        "fee_third_visit": str(new_fee3),
                        "fee_report_check": str(new_fee_report),
                    },
                )

            if bmdc_changed:
                log_audit_event(
                    actor=user,
                    action=AuditLog.ActionChoices.BMDC_UPDATED,
                    target_user=user,
                    details={
                        "old_bmdc": old_user.bmdc_number,
                        "new_bmdc": user.bmdc_number,
                        "reverification_required": True,
                    },
                )

        return user


class PrescriptionForm(forms.ModelForm):
    class Meta:
        model = Prescription
        fields = ["symptoms", "diagnosis", "medications", "notes"]
        widgets = {
            "symptoms": forms.Textarea(
                attrs={"rows": 3, "class": "form-control"}
            ),
            "diagnosis": forms.Textarea(
                attrs={"rows": 3, "class": "form-control"}
            ),
            "medications": CKEditorWidget(config_name="default"),
            "notes": forms.Textarea(
                attrs={"rows": 3, "class": "form-control"}
            ),
        }
