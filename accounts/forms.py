from django import forms
from django.contrib.auth import authenticate
from django.contrib.auth.forms import UserCreationForm

from .models import User, ReceptionistDoctorAssignment, AuditLog, log_audit_event


class DoctorRegistrationForm(UserCreationForm):
    """
    Public registration form for doctors for Green Hospital.
    Captures personal contact, office phone, qualifications, department, specialization,
    and official BMDC registration number. Experience and documents are not mandatory.
    Role is strictly locked to 'doctor' and account remains 'pending_approval' until administrative review.
    """
    phone = forms.CharField(
        max_length=20,
        required=True,
        label="Personal Phone Number",
        widget=forms.TextInput(attrs={"placeholder": "e.g. +8801712345678", "class": "form-control"}),
    )
    office_phone = forms.CharField(
        max_length=30,
        required=False,
        label="Office / Receptionist Phone",
        widget=forms.TextInput(attrs={"placeholder": "e.g. +88029876543", "class": "form-control"}),
    )
    qualifications = forms.CharField(
        max_length=300,
        required=True,
        label="Educational Qualifications",
        widget=forms.TextInput(attrs={"placeholder": "e.g. MBBS, FCPS, MD", "class": "form-control"}),
    )
    department = forms.CharField(
        max_length=150,
        required=True,
        label="Department",
        widget=forms.TextInput(attrs={"placeholder": "e.g. Cardiology, Neurology, General Medicine", "class": "form-control"}),
    )
    specialization = forms.CharField(
        max_length=255,
        required=True,
        label="Specialization",
        widget=forms.TextInput(attrs={"placeholder": "e.g. Interventional Cardiology", "class": "form-control"}),
    )
    bmdc_number = forms.CharField(
        max_length=50,
        required=True,
        label="BMDC Registration Number",
        widget=forms.TextInput(attrs={"placeholder": "e.g. A-12345", "class": "form-control"}),
    )
    experience_notes = forms.CharField(
        max_length=500,
        required=False,
        label="Past Experience (Optional)",
        widget=forms.Textarea(attrs={"rows": 2, "placeholder": "Optional summary of past experience", "class": "form-control"}),
    )

    def __init__(self, *args, **kwargs):
        super(DoctorRegistrationForm, self).__init__(*args, **kwargs)
        self.fields["first_name"].required = True
        self.fields["last_name"].required = True
        self.fields["email"].required = True
        self.fields["first_name"].label = "First name"
        self.fields["last_name"].label = "Last name"
        self.fields["password1"].label = "Password"
        self.fields["password2"].label = "Confirm your password"

        self.fields["first_name"].widget.attrs.update(
            {"placeholder": "Enter first name", "class": "form-control"}
        )
        self.fields["last_name"].widget.attrs.update(
            {"placeholder": "Enter last name", "class": "form-control"}
        )
        self.fields["username"].widget.attrs.update(
            {"placeholder": "Enter username", "class": "form-control"}
        )
        self.fields["email"].widget.attrs.update(
            {"placeholder": "Enter email address", "class": "form-control"}
        )
        self.fields["password1"].widget.attrs.update(
            {"placeholder": "Enter password", "class": "form-control"}
        )
        self.fields["password2"].widget.attrs.update(
            {"placeholder": "Confirm your password", "class": "form-control"}
        )

    class Meta:
        model = User
        fields = [
            "first_name",
            "last_name",
            "username",
            "email",
            "phone",
            "office_phone",
            "qualifications",
            "department",
            "specialization",
            "bmdc_number",
            "experience_notes",
            "password1",
            "password2",
        ]

    def clean_bmdc_number(self):
        bmdc = self.cleaned_data.get("bmdc_number", "").strip()
        if not bmdc:
            raise forms.ValidationError("BMDC registration number is required.")
        if User.objects.filter(bmdc_number__iexact=bmdc).exists():
            raise forms.ValidationError("A doctor with this BMDC registration number is already registered.")
        return bmdc

    def clean(self):
        cleaned_data = super().clean()
        for forbidden in ["role", "is_staff", "is_superuser", "status"]:
            if forbidden in self.data:
                pass
        return cleaned_data

    def save(self, commit=True):
        user = super(UserCreationForm, self).save(commit=False)
        user.role = User.RoleChoices.DOCTOR
        user.status = User.StatusChoices.PENDING_APPROVAL
        user.bmdc_number = self.cleaned_data.get("bmdc_number")
        user.bmdc_verified = False
        user.is_staff = False
        user.is_superuser = False

        if commit:
            user.save()
            profile = user.profile
            profile.phone = self.cleaned_data.get("phone")
            profile.office_phone = self.cleaned_data.get("office_phone")
            profile.department = self.cleaned_data.get("department")
            profile.specialization = self.cleaned_data.get("specialization")
            profile.save()

            qualifications = self.cleaned_data.get("qualifications")
            if qualifications:
                from doctors.models import Education
                Education.objects.create(
                    user=user,
                    degree=qualifications,
                    college="Registered Medical Institution",
                )

            log_audit_event(
                actor=user,
                action=AuditLog.ActionChoices.ROLE_CHANGE,
                target_user=user,
                details={
                    "action": "doctor_registration_pending",
                    "status": user.status,
                    "bmdc_number": user.bmdc_number,
                },
            )
        return user


class PatientRegistrationForm(UserCreationForm):
    """
    Public registration form for patients.
    Privilege escalation is strictly forbidden: role is locked to 'patient'.
    """
    first_name = forms.CharField(required=True)
    last_name = forms.CharField(required=True)

    class Meta:
        model = User
        fields = [
            "first_name",
            "last_name",
            "username",
            "password1",
            "password2",
        ]

    def clean(self):
        cleaned_data = super().clean()
        # Security: Strip any tampering with roles/privileges
        for forbidden in ["role", "is_staff", "is_superuser", "status"]:
            if forbidden in self.data:
                pass
        return cleaned_data

    def save(self, commit=True):
        user = super(UserCreationForm, self).save(commit=False)
        user.role = User.RoleChoices.PATIENT
        user.status = User.StatusChoices.ACTIVE
        user.is_staff = False
        user.is_superuser = False
        if commit:
            user.save()
            log_audit_event(
                actor=user,
                action=AuditLog.ActionChoices.ROLE_CHANGE,
                target_user=user,
                details={"action": "public_patient_registration", "status": user.status},
            )
        return user


class UserLoginForm(forms.Form):
    username = forms.CharField()
    password = forms.CharField(
        label="Password",
        strip=False,
        widget=forms.PasswordInput,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = None
        self.fields["username"].widget.attrs.update(
            {"placeholder": "Enter Username"}
        )
        self.fields["password"].widget.attrs.update(
            {"placeholder": "Enter Password"}
        )

    def clean(self, *args, **kwargs):
        username = self.cleaned_data.get("username")
        password = self.cleaned_data.get("password")

        if username and password:
            self.user = authenticate(username=username, password=password)

            if self.user is None:
                # Check if username exists to log failed login attempt
                existing = User.objects.filter(username=username).first()
                if existing:
                    log_audit_event(
                        actor=None,
                        action=AuditLog.ActionChoices.LOGIN_FAILED,
                        target_user=existing,
                        details={"reason": "invalid_password"},
                    )
                raise forms.ValidationError("Username or password is incorrect.")

            if not self.user.check_password(password):
                raise forms.ValidationError("Username or password is incorrect.")

            if not self.user.is_active:
                raise forms.ValidationError("Account is inactive. Please contact administration.")

            if self.user.status == User.StatusChoices.SUSPENDED:
                raise forms.ValidationError(
                    "Your account has been suspended. Please contact hospital administration."
                )

            if self.user.status == User.StatusChoices.REJECTED:
                raise forms.ValidationError(
                    "Your registration was not approved. Please contact hospital administration."
                )

        return super(UserLoginForm, self).clean(*args, **kwargs)

    def get_user(self):
        return self.user


class StaffRoleAssignmentForm(forms.ModelForm):
    """
    Form restricted to Super Admin only for assigning staff roles and statuses.
    """
    role = forms.ChoiceField(
        choices=[
            (User.RoleChoices.HOSPITAL_ADMIN, "Hospital Admin"),
            (User.RoleChoices.RECEPTIONIST, "Receptionist"),
            (User.RoleChoices.DOCTOR, "Doctor"),
            (User.RoleChoices.PATIENT, "Patient"),
            (User.RoleChoices.SUPER_ADMIN, "Super Admin"),
        ],
        required=True,
    )
    status = forms.ChoiceField(
        choices=User.StatusChoices.choices,
        required=True,
    )

    class Meta:
        model = User
        fields = ["role", "status", "is_staff"]

    def __init__(self, *args, **kwargs):
        self.request_user = kwargs.pop("request_user", None)
        super().__init__(*args, **kwargs)

    def clean(self):
        cleaned_data = super().clean()
        if not self.request_user or not self.request_user.is_super_admin:
            raise forms.ValidationError(
                "Only Super Administrators can assign staff roles or modify staff privileges."
            )
        return cleaned_data


class ReceptionistDoctorAssignmentForm(forms.ModelForm):
    """
    Form for Hospital Administrators and Super Admins to assign
    a receptionist to a doctor.
    """
    receptionist = forms.ModelChoiceField(
        queryset=User.objects.filter(role=User.RoleChoices.RECEPTIONIST, status=User.StatusChoices.ACTIVE),
        empty_label="Select Receptionist",
    )
    doctor = forms.ModelChoiceField(
        queryset=User.objects.filter(role=User.RoleChoices.DOCTOR, status=User.StatusChoices.ACTIVE),
        empty_label="Select Doctor",
    )

    class Meta:
        model = ReceptionistDoctorAssignment
        fields = ["receptionist", "doctor"]
