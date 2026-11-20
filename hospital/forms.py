import re
from datetime import date
from django.utils import timezone
from django import forms
from django.contrib.auth import password_validation
from django.contrib.auth.forms import PasswordChangeForm
from django.core.exceptions import ValidationError
from django.db.models import Q
from .models import (User, DoctorProfile, Department, WeeklyAvailability,
                     AppointmentSlot, Complaint, HospitalPolicy, Appointment)

DATE = forms.DateInput(attrs={'type':'date'})
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
        widget=forms.TextInput(attrs={'placeholder': 'Leave blank for patient1, patient2, etc.'}),
        help_text='Optional. Leave blank to automatically assign patient1, patient2, etc.'
    )
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput(attrs={'autocomplete':'new-password'}))
    password2 = forms.CharField(label='Confirm password', widget=forms.PasswordInput(attrs={'autocomplete':'new-password'}))
    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'username', 'phone', 'dob', 'email', 'nid', 'address']
        widgets = {'dob': DATE, 'address': forms.Textarea(attrs={'rows':2})}
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
        widgets = {'dob': DATE, 'address': forms.Textarea(attrs={'rows':2})}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['phone'].required = True
        self.fields['first_name'].required = True
        self.fields['username'].required = True
        self.style_fields()
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


class StaffForm(forms.ModelForm, FormStyleMixin):
    new_password = forms.CharField(required=False, widget=forms.PasswordInput(attrs={'autocomplete':'new-password'}),
                                   help_text='Required for new accounts; leave empty when editing to keep current password.')
    department = forms.ModelChoiceField(queryset=Department.objects.filter(is_active=True), required=False,
                                         label='Doctor department')
    assigned_receptionist = forms.ModelChoiceField(queryset=User.objects.filter(role='receptionist',is_active=True),
                                                    required=False, label='Assigned receptionist')
    class Meta:
        model = User
        fields = ['role','first_name','last_name','username','email','phone','dob','nid','address','is_active']
        widgets = {'dob': DATE, 'address':forms.Textarea(attrs={'rows':2})}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['role'].choices = [('doctor','Doctor'),('receptionist','Receptionist'),('admin','Administrator')]
        for key in ('role','first_name','last_name','username','email','phone'):
            self.fields[key].required = True
        if not self.instance.pk:
            self.fields['new_password'].required = True
        else:
            self.fields.pop('department')
            self.fields.pop('assigned_receptionist')
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
        if commit: user.save()
        return user


class DoctorSettingsForm(forms.ModelForm, FormStyleMixin):
    class Meta:
        model = DoctorProfile
        fields = ['department','gender','designation','qualifications','registration_number','experience_years',
                  'biography','initial_fee','followup_fee','followup_within_days','report_fee',
                  'hospital_share_mode','hospital_share_value','booking_notice_hours','booking_advance_days',
                  'payment_policy','payment_deadline_hours','cancel_fee_mode','cancel_fee_value',
                  'receptionists','is_available']
        widgets = {'biography':forms.Textarea(attrs={'rows':3})}
    def __init__(self, *args, is_admin=False, **kwargs):
        super().__init__(*args, **kwargs)
        if not is_admin:
            for field in ('department','gender','registration_number','hospital_share_mode','hospital_share_value','receptionists'):
                self.fields.pop(field, None)
        else:
            self.fields['receptionists'].queryset = User.objects.filter(role='receptionist', is_active=True)
        self.style_fields()
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
    visit_type = forms.ChoiceField(choices=Appointment.Visit.choices)
    payment_method = forms.ChoiceField(choices=[('cash','Pay at hospital'),('online','Pay online')])
    notes = forms.CharField(required=False, widget=forms.Textarea(attrs={'rows':2}), label='Reason for visit (optional)')
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.style_fields()


class ReceptionBookingForm(forms.Form, FormStyleMixin):
    slot = forms.ModelChoiceField(queryset=AppointmentSlot.objects.none(), label='Available appointment slot')
    name = forms.CharField(label='Patient full name', max_length=150)
    phone = forms.CharField(label='Patient phone', max_length=16)
    dob = forms.DateField(required=False, label='Patient date of birth (optional)', widget=DATE)
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
