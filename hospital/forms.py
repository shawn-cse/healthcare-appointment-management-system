import re
from datetime import date
from django.utils import timezone
from django import forms
from django.contrib.auth import password_validation
from django.contrib.auth.forms import PasswordChangeForm
from django.core.exceptions import ValidationError
from django.db.models import Q
from .models import (User, DoctorProfile, Department, WeeklyAvailability,
                     AppointmentSlot, Complaint, HospitalPolicy, Appointment, Chamber)

DATE = forms.DateInput(attrs={
    'type': 'text',
    'class': 'field-control green-datepicker',
    'placeholder': 'YYYY-MM-DD',
    'autocomplete': 'off',
    'data-datepicker': 'true'
})
DOB_DATE = forms.DateInput(attrs={
    'type': 'text',
    'class': 'field-control green-datepicker',
    'placeholder': 'Select Date of Birth (YYYY-MM-DD)',
    'autocomplete': 'off',
    'data-datepicker': 'true',
    'data-mode': 'dob',
    'data-max': 'today'
})
TIME = forms.TimeInput(attrs={'type':'time'}, format='%H:%M')


def get_next_patient_username():
    """Finds the next sequential patient username (patient1, patient2, patient3, ...)."""
    patient_names = User.objects.filter(username__istartswith='patient').values_list('username', flat=True)
    existing_nums = set()
    for name in patient_names:
        m = re.match(r'^patient(\d+)$', name, re.IGNORECASE)
        if m:
            existing_nums.add(int(m.group(1)))
    n = 1
    while n in existing_nums or User.objects.filter(
        Q(username__iexact=f'patient{n}') | Q(phone=f'patient{n}') | Q(email__iexact=f'patient{n}')
    ).exists():
        n += 1
    return f'patient{n}'

class FormStyleMixin:
    def style_fields(self):
        for field in self.fields.values():
            if isinstance(field.widget, forms.CheckboxInput):
                field.widget.attrs.setdefault('class', 'check')
            else:
                field.widget.attrs.setdefault('class', 'field-control')

class RegisterForm(forms.ModelForm, FormStyleMixin):
    username = forms.CharField(
        label='Username (optional)',
        required=False,
        widget=forms.TextInput(attrs={'placeholder': 'Choose a username (optional)'}),
    )
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput(attrs={'autocomplete':'new-password'}))
    password2 = forms.CharField(label='Confirm password', widget=forms.PasswordInput(attrs={'autocomplete':'new-password'}))
    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'username', 'phone', 'dob', 'email', 'nid', 'address']
        widgets = {'dob': DOB_DATE, 'address': forms.Textarea(attrs={'rows':2})}
        labels = {'first_name':'First name', 'last_name':'Last name', 'username':'Username (optional)',
                  'dob':'Date of birth', 'nid':'NID (optional)', 'address':'Address (optional)', 'email':'Email (optional)'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['first_name'].required = True
        self.fields['last_name'].required = True
        self.fields['phone'].required = True
        self.fields['dob'].required = True
        self.fields['username'].required = False
        self.style_fields()

    def clean_username(self):
        v = self.cleaned_data.get('username', '').strip()
        if v:
            if User.objects.filter(Q(username__iexact=v) | Q(phone=v) | Q(email__iexact=v)).exists():
                raise ValidationError('An account with this username, phone or email already exists.')
        return v

    def clean_dob(self):
        v = self.cleaned_data['dob']
        if v and v > timezone.localdate():
            raise ValidationError('Date of birth cannot be in the future.')
        return v

    def clean_email(self):
        email = self.cleaned_data.get('email', '').strip().lower()
        if email and User.objects.filter(email__iexact=email).exists():
            raise ValidationError('An account with this email already exists.')
        return email

    def clean_password2(self):
        p = self.cleaned_data.get('password1')
        if p != self.cleaned_data.get('password2'):
            raise ValidationError('Passwords do not match.')
        if p:
            password_validation.validate_password(p)
        return self.cleaned_data.get('password2')

    def save(self, commit=True):
        u = super().save(commit=False)
        u.role = 'patient'
        v = self.cleaned_data.get('username', '').strip()
        if not v:
            u.username = get_next_patient_username()
        else:
            u.username = v
        u.set_password(self.cleaned_data['password1'])
        if commit: u.save()
        return u


class ProfileForm(forms.ModelForm, FormStyleMixin):
    class Meta:
        model = User
        fields = ['first_name','last_name','username','email','phone','dob','nid','address','avatar']
        widgets = {'dob': DOB_DATE, 'address': forms.Textarea(attrs={'rows':2})}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['phone'].required = True
        self.fields['first_name'].required = True
        self.fields['username'].required = True
        if self.instance and self.instance.role == 'doctor' and hasattr(self.instance, 'doctor_profile'):
            doc = self.instance.doctor_profile
            self.fields['designation'] = forms.CharField(
                max_length=200, required=False, initial=doc.designation,
                label='Doctor Designation / Title',
                help_text='e.g. Associate Professor, ENT & Head Neck Surgery'
            )
            self.fields['qualifications'] = forms.CharField(
                widget=forms.Textarea(attrs={'rows': 4, 'placeholder': 'MBBS, FCPS (Otolaryngology), FICS (USA)\nMicro-laryngeal Surgery Specialist\nConsultant Otolaryngologist'}),
                required=False, initial=doc.qualifications,
                label='Degrees & Qualifications',
                help_text='One degree or qualification per line (bullet points are automatically formatted).'
            )
        self.style_fields()

    def save(self, commit=True):
        user = super().save(commit=commit)
        if user.role == 'doctor' and hasattr(user, 'doctor_profile'):
            doc = user.doctor_profile
            if 'designation' in self.cleaned_data:
                doc.designation = self.cleaned_data['designation']
            if 'qualifications' in self.cleaned_data:
                doc.qualifications = self.cleaned_data['qualifications']
            doc.save()
        return user
    def clean_username(self):
        v = self.cleaned_data.get('username', '').strip()
        if not v:
            raise ValidationError('Username cannot be empty.')
        if User.objects.filter(Q(username__iexact=v) | Q(phone=v) | Q(email__iexact=v)).exclude(pk=self.instance.pk).exists():
            raise ValidationError('This username conflicts with another account identifier.')
        return v
    def clean_email(self):
        email = self.cleaned_data.get('email', '').strip().lower()
        if email and User.objects.filter(email__iexact=email).exclude(pk=self.instance.pk).exists():
            raise ValidationError('An account with this email already exists.')
        return email

    def clean_dob(self):
        v = self.cleaned_data.get('dob')
        if self.instance.role == 'patient' and not v:
            raise ValidationError('Date of birth is required.')
        if v and v > timezone.localdate():
            raise ValidationError('Date of birth cannot be in the future.')
        return v


WEEKDAY_CHOICES = [
    ('0', 'Monday'), ('1', 'Tuesday'), ('2', 'Wednesday'), ('3', 'Thursday'),
    ('4', 'Friday'), ('5', 'Saturday'), ('6', 'Sunday')
]


class StaffForm(forms.ModelForm, FormStyleMixin):
    new_password = forms.CharField(required=False, widget=forms.PasswordInput(attrs={'autocomplete':'new-password'}),
                                   help_text='Required for new accounts; leave empty when editing to keep current password.')
    department = forms.ModelChoiceField(queryset=Department.objects.filter(is_active=True), required=False,
                                         label='Doctor Department')
    assigned_receptionist = forms.ModelChoiceField(queryset=User.objects.filter(role='receptionist',is_active=True),
                                                    required=False, label='Receptionist',
                                                    help_text='Select the receptionist responsible for this doctor.')
    chamber = forms.ModelChoiceField(queryset=Chamber.objects.filter(is_active=True), required=False,
                                     label='Chamber & Room Number', help_text='Select the consultation room for this doctor.')
    designation = forms.CharField(max_length=200, required=False, label='Doctor Designation',
                                  help_text='e.g. Associate Professor, ENT')
    qualifications = forms.CharField(
        widget=forms.Textarea(attrs={'rows': 3, 'placeholder': 'e.g. MBBS, FCPS, MS'}),
        required=False, label='Degrees & Qualifications',
        help_text='Enter qualifications (one per line or comma-separated).'
    )
    consultation_days = forms.MultipleChoiceField(
        choices=WEEKDAY_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        required=False,
        label='Weekly Consultation Days in this Chamber',
        help_text='Select which days this doctor will consult in this chamber (e.g. Mon, Wed, Fri).'
    )
    consultation_start_time = forms.TimeField(
        widget=TIME, required=False, initial='18:00', label='Daily Session Start Time'
    )
    consultation_end_time = forms.TimeField(
        widget=TIME, required=False, initial='20:00', label='Daily Session End Time'
    )

    class Meta:
        model = User
        fields = ['role','first_name','last_name','username','email','phone','dob','nid','address','is_active']
        widgets = {'dob': DOB_DATE, 'address':forms.Textarea(attrs={'rows':2})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['role'].choices = [('doctor','Doctor'),('receptionist','Receptionist'),('admin','Administrator')]
        for key in ('role','first_name','last_name','username','email','phone'):
            self.fields[key].required = True
        chambers_qs = Chamber.objects.filter(is_active=True).prefetch_related('doctors__user')
        self.fields['chamber'].queryset = chambers_qs
        self.fields['chamber'].label_from_instance = lambda c: f"{c.building} · {c.room_number} ({c.floor}) - {c.description} [{'Occupied: ' + ', '.join([d.user.display_name for d in c.doctors.all()]) if c.doctors.exists() else 'Empty / Available'}]"

        if not self.instance.pk:
            self.fields['new_password'].required = True
        else:
            if self.instance.role == 'doctor' and hasattr(self.instance, 'doctor_profile'):
                doc = self.instance.doctor_profile
                self.fields['department'].initial = doc.department
                self.fields['chamber'].initial = doc.chamber
                self.fields['assigned_receptionist'].initial = doc.receptionists.filter(is_active=True).first()
                self.fields['designation'].initial = doc.designation
                self.fields['qualifications'].initial = doc.qualifications
            else:
                self.fields.pop('department', None)
                self.fields.pop('assigned_receptionist', None)
                self.fields.pop('chamber', None)
                self.fields.pop('designation', None)
                self.fields.pop('qualifications', None)
            self.fields.pop('consultation_days', None)
            self.fields.pop('consultation_start_time', None)
            self.fields.pop('consultation_end_time', None)
        self.style_fields()

    def clean_email(self):
        v = self.cleaned_data['email'].strip().lower()
        if User.objects.filter(email__iexact=v).exclude(pk=self.instance.pk).exists():
            raise ValidationError('This email address is already associated with an account.')
        return v

    def clean_username(self):
        value = self.cleaned_data['username']
        if User.objects.filter(Q(username__iexact=value) | Q(phone=value) | Q(email__iexact=value)).exclude(pk=self.instance.pk).exists():
            raise ValidationError('This username conflicts with another account identifier.')
        return value

    def clean(self):
        data = super().clean()
        if self.instance.pk and data.get('role') and data['role'] != self.instance.role:
            self.add_error('role', 'For audit integrity, create a new account for a different staff role.')
        if not self.instance.pk and data.get('role') == 'doctor':
            if not data.get('department'):
                self.add_error('department', 'Choose a department for the new doctor.')
            if not data.get('assigned_receptionist'):
                self.add_error('assigned_receptionist', 'Assign a receptionist when creating a doctor.')
            if not data.get('chamber'):
                self.add_error('chamber', 'Assign a consultation chamber/room for the new doctor.')
            if not data.get('consultation_days'):
                self.add_error('consultation_days', 'Select which weekly days the doctor will consult in this chamber.')
        return data
    def clean_new_password(self):
        value = self.cleaned_data.get('new_password')
        if value:
            password_validation.validate_password(value)
        return value
    def save(self, commit=True):
        user = super().save(commit=False)
        if self.cleaned_data.get('new_password'):
            user.set_password(self.cleaned_data['new_password'])
        user.is_staff = user.role == 'admin'
        user.is_superuser = user.role == 'admin'
        if commit:
            user.save()
            if user.role == 'doctor' and hasattr(user, 'doctor_profile'):
                doc = user.doctor_profile
                if 'department' in self.cleaned_data and self.cleaned_data['department']:
                    doc.department = self.cleaned_data['department']
                if 'chamber' in self.cleaned_data:
                    ch = self.cleaned_data['chamber']
                    doc.chamber = ch
                    if ch:
                        doc.room_number = ch.room_number
                        doc.chamber_address = ch.address
                        doc.contact_number = ch.contact_number
                if 'designation' in self.cleaned_data:
                    doc.designation = self.cleaned_data['designation']
                if 'qualifications' in self.cleaned_data:
                    doc.qualifications = self.cleaned_data['qualifications']
                if 'assigned_receptionist' in self.cleaned_data:
                    rec = self.cleaned_data['assigned_receptionist']
                    if rec:
                        doc.receptionists.set([rec])
                    else:
                        doc.receptionists.clear()
                doc.save()
        return user


class DoctorSettingsForm(forms.ModelForm, FormStyleMixin):
    receptionist = forms.ModelChoiceField(
        queryset=User.objects.filter(role='receptionist', is_active=True),
        required=False,
        label='Receptionist',
        help_text='Select the receptionist responsible for this doctor’s consultations.'
    )

    class Meta:
        model = DoctorProfile
        fields = ['chamber','department','gender','designation','qualifications','registration_number','experience_years',
                  'biography','initial_fee','followup_fee','followup_within_days','report_fee',
                  'hospital_share_mode','hospital_share_value','booking_notice_hours','booking_advance_days',
                  'payment_policy','payment_deadline_hours','cancel_fee_mode','cancel_fee_value',
                  'is_available']
        widgets = {
            'biography': forms.Textarea(attrs={'rows':3}),
            'qualifications': forms.Textarea(attrs={'rows': 4, 'placeholder': 'e.g. MBBS, FCPS (Otolaryngology), FICS (USA)\nMicro-laryngeal Surgery Specialist\nConsultant Otolaryngologist'}),
        }
    def __init__(self, *args, is_admin=False, **kwargs):
        super().__init__(*args, **kwargs)
        if not is_admin:
            for field in ('chamber','department','gender','registration_number','hospital_share_mode','hospital_share_value','receptionist'):
                self.fields.pop(field, None)
        else:
            self.fields['receptionist'].queryset = User.objects.filter(role='receptionist', is_active=True)
            if self.instance and self.instance.pk:
                self.fields['receptionist'].initial = self.instance.receptionists.filter(is_active=True).first()
            self.fields['chamber'].queryset = Chamber.objects.filter(is_active=True)
            self.fields['chamber'].required = False
            self.fields['chamber'].label = 'Assigned Chamber & Room'
        self.style_fields()

    def save(self, commit=True):
        doc = super().save(commit=commit)
        if commit and 'receptionist' in self.cleaned_data:
            rec = self.cleaned_data.get('receptionist')
            if rec:
                doc.receptionists.set([rec])
            else:
                doc.receptionists.clear()
        return doc
    def clean(self):
        data = super().clean()
        for kind in ('hospital','cancel'):
            mode = data.get('hospital_share_mode') if kind == 'hospital' else data.get('cancel_fee_mode')
            value = data.get('hospital_share_value') if kind == 'hospital' else data.get('cancel_fee_value')
            if mode == 'percent' and value is not None and value > 100:
                self.add_error(f'{kind}_share_value' if kind == 'hospital' else 'cancel_fee_value',
                               'Percentage cannot exceed 100.')
        return data


class WeeklyForm(forms.ModelForm, FormStyleMixin):
    class Meta:
        model = WeeklyAvailability
        fields = ['weekday','start_time','end_time','duration_minutes','capacity','active']
        widgets = {'start_time':TIME,'end_time':TIME}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.style_fields()
    def clean(self):
        data = super().clean()
        if data.get('start_time') and data.get('end_time') and data['end_time'] <= data['start_time']:
            self.add_error('end_time', 'End time must be later than start time.')
        return data


class SlotForm(forms.ModelForm, FormStyleMixin):
    class Meta:
        model = AppointmentSlot
        fields = ['doctor','date','start_time','end_time','capacity','is_open']
        widgets = {'date':DATE,'start_time':TIME,'end_time':TIME}
    def __init__(self, *args, doctors=None, **kwargs):
        super().__init__(*args, **kwargs)
        if doctors is not None: self.fields['doctor'].queryset = doctors
        self.style_fields()
    def clean(self):
        values = super().clean()
        if values.get('start_time') and values.get('end_time') and values['end_time'] <= values['start_time']:
            self.add_error('end_time','End must be later than start.')
        if values.get('date') and values['date'] < timezone.localdate():
            self.add_error('date','Select today or a future date.')
        return values


class PatientBookingForm(forms.Form, FormStyleMixin):
    visit_type = forms.ChoiceField(choices=Appointment.Visit.choices, label='Consultation Type')
    payment_method = forms.ChoiceField(choices=[('cash','Pay at hospital'),('online','Pay online')], label='Payment Method')
    notes = forms.CharField(required=False, widget=forms.Textarea(attrs={'rows':2, 'placeholder':'Optional reason for visit, symptoms, or remarks'}), label='Reason for visit (optional)')
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.style_fields()


class StaffAssistedBookingForm(forms.Form, FormStyleMixin):
    name = forms.CharField(
        label='Patient Full Name',
        max_length=150,
        widget=forms.TextInput(attrs={'placeholder': 'e.g. Mohammad Ali', 'autocomplete': 'name'})
    )
    phone = forms.CharField(
        label='Patient Contact Phone',
        max_length=16,
        widget=forms.TextInput(attrs={'placeholder': '+8801712345678', 'autocomplete': 'tel'})
    )
    dob = forms.DateField(
        required=False,
        label='Date of Birth (optional)',
        widget=DOB_DATE
    )
    patient = forms.ModelChoiceField(
        queryset=User.objects.filter(role='patient', is_active=True),
        required=False,
        label='Link Registered Patient (optional)',
        help_text='If the patient already has an account, select it to attach visit to their history.'
    )
    visit_type = forms.ChoiceField(
        choices=Appointment.Visit.choices,
        label='Consultation Type',
        initial=Appointment.Visit.FIRST
    )
    source = forms.ChoiceField(
        choices=[
            ('desk', 'Reception Desk / Walk-in'),
            ('phone', 'Telephone / Helpline'),
            ('web', 'Assisted Online / Email')
        ],
        label='Booking Channel',
        initial='desk'
    )
    payment_choice = forms.ChoiceField(
        choices=[
            ('cash', 'Cash Collected Now (mark paid & generate receipt immediately)'),
            ('later', 'Pay Later (unpaid - collect at reception on appointment day)')
        ],
        label='Payment Collection',
        initial='cash'
    )
    notes = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={'rows': 2, 'placeholder': 'Optional internal notes, symptoms, or special instructions'}),
        label='Staff & Consultation Notes (optional)'
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.is_bound and self.data.get('phone'):
            phone = self.data.get('phone', '').strip()
            self.fields['patient'].queryset = User.objects.filter(role='patient', phone=phone)
        else:
            self.fields['patient'].queryset = User.objects.filter(role='patient', is_active=True)[:100]
        self.style_fields()

    def clean_dob(self):
        v = self.cleaned_data.get('dob')
        if v and v > timezone.localdate():
            raise ValidationError('Date of birth cannot be in the future.')
        return v


class ChamberForm(forms.ModelForm, FormStyleMixin):
    doctors = forms.ModelMultipleChoiceField(
        queryset=DoctorProfile.objects.filter(user__is_active=True).select_related('user', 'department'),
        required=False,
        label='Assign Doctors to this Chamber',
        help_text='Select doctors consulting in this chamber. Room number, building, address and hotline will sync automatically.'
    )

    class Meta:
        model = Chamber
        fields = ['building', 'room_number', 'floor', 'description', 'name', 'address', 'contact_number', 'department', 'is_active']
        widgets = {
            'building': forms.TextInput(attrs={'placeholder': 'e.g. Building 1, Building 3'}),
            'room_number': forms.TextInput(attrs={'placeholder': 'e.g. Chamber 302, Chamber 202'}),
            'floor': forms.TextInput(attrs={'placeholder': 'e.g. 3rd Floor, 2nd Floor'}),
            'description': forms.TextInput(attrs={'placeholder': 'e.g. Building 1, chamber 302'}),
            'name': forms.TextInput(attrs={'placeholder': 'e.g. Mirpur Central Outpatient Wing'}),
            'address': forms.TextInput(attrs={'placeholder': 'e.g. Mirpur, Dhaka'}),
            'contact_number': forms.TextInput(attrs={'placeholder': 'e.g. +88096100016211'}),
        }
        labels = {
            'building': 'Building / Wing',
            'room_number': 'Chamber / Room Number',
            'floor': 'Floor Level',
            'description': 'Room Description (e.g. Building 1, chamber 302)',
            'name': 'Center / Chamber Name',
            'address': 'Chamber Address (Mirpur, Dhaka)',
            'contact_number': 'Hotline Number (+88096100016211)',
            'department': 'Primary Department (optional)',
            'is_active': 'Active for Consultations',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields['doctors'].initial = self.instance.doctors.all()
        self.style_fields()

    def save(self, commit=True):
        chamber = super().save(commit=commit)
        if commit:
            assigned = list(self.cleaned_data.get('doctors') or [])
            # Unassign doctors no longer selected
            DoctorProfile.objects.filter(chamber=chamber).exclude(pk__in=[d.pk for d in assigned]).update(chamber=None)
            # Assign selected doctors and synchronize chamber data
            for doc in assigned:
                doc.chamber = chamber
                doc.room_number = chamber.room_number
                doc.chamber_address = chamber.address
                doc.contact_number = chamber.contact_number
                doc.save()
        return chamber


class StaffAssistedBookingForm(forms.Form, FormStyleMixin):
    name = forms.CharField(
        label='Patient Full Name',
        max_length=150,
        widget=forms.TextInput(attrs={'placeholder': 'e.g. Mohammad Ali', 'autocomplete': 'name'})
    )
    phone = forms.CharField(
        label='Patient Contact Phone',
        max_length=16,
        widget=forms.TextInput(attrs={'placeholder': '+8801712345678', 'autocomplete': 'tel'})
    )
    dob = forms.DateField(
        required=False,
        label='Date of Birth (optional)',
        widget=DOB_DATE
    )
    patient = forms.ModelChoiceField(
        queryset=User.objects.filter(role='patient', is_active=True),
        required=False,
        label='Link Registered Patient (optional)',
        help_text='If the patient already has an account, select it to attach visit to their history.'
    )
    visit_type = forms.ChoiceField(
        choices=Appointment.Visit.choices,
        label='Consultation Type',
        initial=Appointment.Visit.FIRST
    )
    source = forms.ChoiceField(
        choices=[
            ('desk', 'Reception Desk / Walk-in'),
            ('phone', 'Telephone / Helpline'),
            ('web', 'Assisted Online / Email')
        ],
        label='Booking Channel',
        initial='desk'
    )
    payment_choice = forms.ChoiceField(
        choices=[
            ('cash', 'Cash Collected Now (mark paid & generate receipt immediately)'),
            ('later', 'Pay Later (unpaid - collect at reception on appointment day)')
        ],
        label='Payment Collection',
        initial='cash'
    )
    notes = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={'rows': 2, 'placeholder': 'Optional internal notes, symptoms, or special instructions'}),
        label='Staff & Consultation Notes (optional)'
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.is_bound and self.data.get('phone'):
            phone = self.data.get('phone', '').strip()
            self.fields['patient'].queryset = User.objects.filter(role='patient', phone=phone)
        else:
            self.fields['patient'].queryset = User.objects.filter(role='patient', is_active=True)[:100]
        self.style_fields()

    def clean_dob(self):
        v = self.cleaned_data.get('dob')
        if v and v > timezone.localdate():
            raise ValidationError('Date of birth cannot be in the future.')
        return v


class ChamberForm(forms.ModelForm, FormStyleMixin):
    doctors = forms.ModelMultipleChoiceField(
        queryset=DoctorProfile.objects.filter(user__is_active=True).select_related('user', 'department'),
        required=False,
        label='Assign Doctors to this Chamber',
        help_text='Select doctors consulting in this chamber. Room number, building, address and hotline will sync automatically.'
    )

    class Meta:
        model = Chamber
        fields = ['building', 'room_number', 'floor', 'description', 'name', 'address', 'contact_number', 'department', 'is_active']
        widgets = {
            'building': forms.TextInput(attrs={'placeholder': 'e.g. Building 1, Building 3'}),
            'room_number': forms.TextInput(attrs={'placeholder': 'e.g. Chamber 302, Chamber 202'}),
            'floor': forms.TextInput(attrs={'placeholder': 'e.g. 3rd Floor, 2nd Floor'}),
            'description': forms.TextInput(attrs={'placeholder': 'e.g. Building 1, chamber 302'}),
            'name': forms.TextInput(attrs={'placeholder': 'e.g. Mirpur Central Outpatient Wing'}),
            'address': forms.TextInput(attrs={'placeholder': 'e.g. Mirpur, Dhaka'}),
            'contact_number': forms.TextInput(attrs={'placeholder': 'e.g. +88096100016211'}),
        }
        labels = {
            'building': 'Building / Wing',
            'room_number': 'Chamber / Room Number',
            'floor': 'Floor Level',
            'description': 'Room Description (e.g. Building 1, chamber 302)',
            'name': 'Center / Chamber Name',
            'address': 'Chamber Address (Mirpur, Dhaka)',
            'contact_number': 'Hotline Number (+88096100016211)',
            'department': 'Primary Department (optional)',
            'is_active': 'Active for Consultations',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields['doctors'].initial = self.instance.doctors.all()
        self.style_fields()

    def save(self, commit=True):
        chamber = super().save(commit=commit)
        if commit:
            assigned = list(self.cleaned_data.get('doctors') or [])
            # Unassign doctors no longer selected
            DoctorProfile.objects.filter(chamber=chamber).exclude(pk__in=[d.pk for d in assigned]).update(chamber=None)
            # Assign selected doctors and synchronize chamber data
            for doc in assigned:
                doc.chamber = chamber
                doc.room_number = chamber.room_number
                doc.chamber_address = chamber.address
                doc.contact_number = chamber.contact_number
                doc.save()
        return chamber


class ReceptionBookingForm(forms.Form, FormStyleMixin):
    slot = forms.ModelChoiceField(queryset=AppointmentSlot.objects.none(), label='Available appointment slot')
    name = forms.CharField(label='Patient full name', max_length=150)
    phone = forms.CharField(label='Patient phone', max_length=16)
    dob = forms.DateField(required=False, label='Patient date of birth (optional)', widget=DOB_DATE)
    patient = forms.ModelChoiceField(queryset=User.objects.filter(role='patient'), required=False,
                                      label='Existing patient account (optional)', help_text='Choose only after confirming identity.')
    identity_verified = forms.BooleanField(required=False, label='Identity confirmed for linked account')
    visit_type = forms.ChoiceField(choices=Appointment.Visit.choices)
    source = forms.ChoiceField(choices=[('desk','Walk-in'),('phone','Telephone')])
    payment_choice = forms.ChoiceField(choices=[('later','Unpaid / collect later'),('cash','Cash collected now')])
    notes = forms.CharField(required=False, widget=forms.Textarea(attrs={'rows':2}))
    def __init__(self, *args, doctors=None, **kwargs):
        super().__init__(*args, **kwargs)
        ids = [int(self.data.get('slot'))] if self.is_bound and str(self.data.get('slot', '')).isdigit() else []
        self.fields['patient'].queryset = User.objects.filter(role='patient', phone=self.data.get('phone','')) if self.is_bound else User.objects.none()
        self.fields['slot'].queryset = AppointmentSlot.objects.filter(
            doctor__in=doctors, is_open=True, date__gte=timezone.localdate(), pk__in=ids).select_related('doctor__user')
        self.style_fields()
    def clean(self):
        values = super().clean()
        if values.get('patient'):
            if not values.get('identity_verified'):
                self.add_error('identity_verified','Confirm identity before linking to an existing account.')
            elif values['patient'].phone != values.get('phone'):
                self.add_error('phone','Phone must match the chosen patient account.')
        if values.get('dob') and values['dob'] > timezone.localdate():
            self.add_error('dob','Invalid date of birth.')
        return values


class ComplaintForm(forms.ModelForm, FormStyleMixin):
    class Meta:
        model = Complaint
        fields = ['appointment','category','subject','message']
        widgets = {'message':forms.Textarea(attrs={'rows':5})}
    def __init__(self, *args, patient=None, **kwargs):
        super().__init__(*args, **kwargs)
        if patient: self.fields['appointment'].queryset = Appointment.objects.filter(patient=patient)
        self.fields['appointment'].required = False
        self.style_fields()


class PolicyForm(forms.ModelForm, FormStyleMixin):
    class Meta:
        model = HospitalPolicy
        fields = ['default_notice_hours','default_advance_days','default_payment_hours',
                  'default_cancel_mode','default_cancel_value','default_hospital_mode','default_hospital_value']
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.style_fields()
    def clean(self):
        data = super().clean()
        if data.get('default_advance_days') is not None and data['default_advance_days'] < 1:
            self.add_error('default_advance_days','Advance booking period must be at least one day.')
        if data.get('default_payment_hours') is not None and data['default_payment_hours'] < 1:
            self.add_error('default_payment_hours','Payment deadline must be at least one hour.')
        for mode_field,value_field in (('default_cancel_mode','default_cancel_value'),
                                       ('default_hospital_mode','default_hospital_value')):
            if data.get(mode_field) == 'percent' and data.get(value_field) is not None and data[value_field] > 100:
                self.add_error(value_field,'A percentage cannot exceed 100%.')
        return data
