import uuid
from decimal import Decimal
from datetime import timedelta
from django.contrib.auth.models import AbstractUser, UserManager
from django.core.validators import MinValueValidator, MaxValueValidator, RegexValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.text import slugify

money_min = MinValueValidator(Decimal('0'))
phone_validator = RegexValidator(r'^\+?[0-9]{10,15}$', 'Enter a valid phone number (10–15 digits).')


class HospitalUserManager(UserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields['role'] = 'admin'
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    class Roles(models.TextChoices):
        PATIENT = 'patient', 'Patient'
        DOCTOR = 'doctor', 'Doctor'
        RECEPTIONIST = 'receptionist', 'Receptionist'
        ADMIN = 'admin', 'Administrator'
    objects = HospitalUserManager()
    role = models.CharField(max_length=16, choices=Roles.choices, default=Roles.PATIENT, db_index=True)
    phone = models.CharField(max_length=16, unique=True, null=True, blank=True, validators=[phone_validator])
    dob = models.DateField('date of birth', null=True, blank=True)
    nid = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    avatar = models.ImageField(upload_to='profiles/', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(Lower('email'),
                      condition=~models.Q(email=''), name='unique_user_email_case_insensitive')]

    def __str__(self):
        return self.get_full_name() or self.username

    @property
    def display_name(self):
        return self.get_full_name() or self.username


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(unique=True)
    description = models.CharField(max_length=255, blank=True)
    icon = models.CharField(max_length=32, default='heart-pulse')
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class HospitalPolicy(models.Model):
    """Global defaults for NEW doctors. Existing doctor rules remain explicit."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    default_notice_hours = models.PositiveIntegerField(default=24)
    default_advance_days = models.PositiveIntegerField(default=60)
    default_payment_hours = models.PositiveIntegerField(default=4)
    default_cancel_mode = models.CharField(max_length=10, choices=[('percent','Percentage'), ('fixed','Fixed amount')], default='percent')
    default_cancel_value = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal('10.00'), validators=[money_min])
    default_hospital_mode = models.CharField(max_length=10, choices=[('percent','Percentage'), ('fixed','Fixed amount')], default='percent')
    default_hospital_value = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal('10.00'), validators=[money_min])
    updated_at = models.DateTimeField(auto_now=True)
    @classmethod
    def current(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Chamber(models.Model):
    building = models.CharField(max_length=80, blank=True, default="Building 1", help_text="e.g. Building 1, Building 2, Building 3")
    name = models.CharField(max_length=150, help_text="Chamber, Hospital or Diagnostic Center name")
    room_number = models.CharField(max_length=50, default="Chamber 302")
    floor = models.CharField(max_length=50, blank=True, default="3rd Floor")
    description = models.CharField(max_length=255, blank=True, default="Building 1, chamber 302", help_text="e.g. Building 1, chamber 302")
    address = models.CharField(max_length=255, default="Mirpur, Dhaka")
    contact_number = models.CharField(max_length=120, default="+88096100016211")
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='chambers')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['building', 'room_number']

    def __str__(self):
        prefix = f"{self.building} · " if self.building else ""
        return f"{prefix}{self.name} ({self.room_number})"

    @property
    def display_code(self):
        if self.building and self.room_number:
            return f"{self.building}, {self.room_number}"
        return self.room_number

    @property
    def doctors_count(self):
        return self.doctors.filter(user__is_active=True).count()

    @property
    def is_empty(self):
        return self.doctors_count == 0

    @property
    def doctors_with_days(self):
        return self.doctors.filter(user__is_active=True).select_related('user', 'department').prefetch_related('weekly')

    @property
    def day_conflicts(self):
        """Returns days where multiple doctors are scheduled in this room."""
        from collections import defaultdict
        day_map = defaultdict(list)
        for doc in self.doctors_with_days:
            for day in doc.assigned_days_display:
                day_map[day].append(doc.user.display_name)
        return {day: docs for day, docs in day_map.items() if len(docs) > 1}


class DoctorProfile(models.Model):
    class Policy(models.TextChoices):
        PAY_ON_DAY = 'on_day', 'Pay on appointment day'
        PAY_WITHIN = 'within', 'Pay within deadline'
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='doctor_profile')
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name='doctors')
    chamber = models.ForeignKey(Chamber, on_delete=models.SET_NULL, null=True, blank=True, related_name='doctors')
    chamber_days = models.CharField(max_length=50, blank=True, default='0,2', help_text='Comma-separated weekday numbers (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun)')
    gender = models.CharField(max_length=10, choices=[('male','Male'), ('female','Female'), ('other','Other')], default='male')
    qualifications = models.TextField(blank=True, help_text="Medical degrees, special training, and specialties (one per line)")
    designation = models.CharField(max_length=150, default='Consultant')
    registration_number = models.CharField(max_length=100, blank=True, help_text="BMDC Registration Number")
    experience_years = models.PositiveSmallIntegerField(default=0)
    biography = models.TextField(blank=True)
    initial_fee = models.DecimalField(max_digits=9, decimal_places=2, default=1000, validators=[money_min])
    followup_fee = models.DecimalField(max_digits=9, decimal_places=2, default=800, validators=[money_min])
    followup_within_days = models.PositiveIntegerField(default=30, validators=[MinValueValidator(1)])
    report_fee = models.DecimalField(max_digits=9, decimal_places=2, default=500, validators=[money_min])
    max_patients_per_session = models.PositiveSmallIntegerField(default=30, validators=[MinValueValidator(1), MaxValueValidator(150)])
    hospital_share_mode = models.CharField(max_length=10, choices=[('percent','Percentage'), ('fixed','Fixed amount')], default='percent')
    hospital_share_value = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal('10.00'), validators=[money_min])
    booking_notice_hours = models.PositiveIntegerField(default=24, help_text="Minimum hours before session to allow online booking")
    booking_advance_days = models.PositiveIntegerField(default=60, validators=[MinValueValidator(1)])
    payment_policy = models.CharField(max_length=10, choices=Policy.choices, default=Policy.PAY_ON_DAY)
    payment_deadline_hours = models.PositiveIntegerField(default=4, validators=[MinValueValidator(1)])
    cancel_fee_mode = models.CharField(max_length=10, choices=[('percent','Percentage'), ('fixed','Fixed amount')], default='percent')
    cancel_fee_value = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal('10.00'), validators=[money_min])
    receptionists = models.ManyToManyField(User, blank=True, related_name='assigned_doctors')
    title_prefix = models.CharField(max_length=40, default='Dr.', blank=True)
    institute = models.CharField(max_length=200, blank=True, default='')
    room_number = models.CharField(max_length=50, blank=True, default='Chamber 302')
    chamber_address = models.CharField(max_length=255, blank=True, default='Mirpur, Dhaka')
    contact_number = models.CharField(max_length=100, blank=True, default='+88096100016211')
    is_available = models.BooleanField(default=True)

    class Meta:
        ordering = ['user__first_name', 'user__last_name']

    @property
    def full_doctor_title(self):
        prefix = self.title_prefix.strip() if self.title_prefix else 'Dr.'
        return f'{prefix} {self.user.display_name}'

    @property
    def bmdc_display(self):
        reg = self.registration_number.strip() if self.registration_number else ''
        if reg:
            return reg if reg.upper().startswith('BMDC') else f'BMDC Reg: {reg}'
        return f'BMDC Reg: A-{10000 + (self.pk * 317) % 89999}'

    @property
    def qualifications_list(self):
        if not self.qualifications:
            return []
        return [line.strip() for line in self.qualifications.splitlines() if line.strip()]

    @property
    def default_avatar(self):
        return 'ic-doc-female' if self.gender == 'female' else 'ic-doc-male'

    @property
    def assigned_receptionist_name(self):
        rec = self.receptionists.filter(is_active=True).first()
        if rec:
            return rec.get_full_name() or rec.username
        return 'Front Desk Reception'

    @property
    def active_room(self):
        if self.chamber:
            return self.chamber.room_number
        return self.room_number or 'Chamber 302'

    @property
    def active_address(self):
        if self.chamber:
            return self.chamber.address
        return self.chamber_address or 'Mirpur, Dhaka'

    @property
    def active_contact(self):
        if self.chamber:
            return self.chamber.contact_number
        return self.contact_number or '+88096100016211'

    @property
    def assigned_days_list(self):
        """Returns list of integers for assigned weekdays [0, 1, 2, ...]."""
        days = list(self.weekly.filter(active=True).values_list('weekday', flat=True).distinct().order_by('weekday'))
        if not days and self.chamber_days:
            try:
                days = [int(x.strip()) for x in self.chamber_days.split(',') if x.strip().isdigit()]
            except ValueError:
                pass
        return days

    @property
    def assigned_days_display(self):
        WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        return [WEEKDAY_NAMES[d] for d in self.assigned_days_list if 0 <= d <= 6]

    @property
    def assigned_days_text(self):
        d = self.assigned_days_display
        return ', '.join(d) if d else 'Unscheduled'

    @property
    def profile_slug(self):
        if self.user and self.user.username:
            return self.user.username
        return str(self.pk)

    def get_absolute_url(self):
        from django.urls import reverse
        return reverse('doctor_detail', args=[self.profile_slug])

    def save(self, *args, **kwargs):
        if self.chamber:
            self.room_number = self.chamber.room_number
            self.chamber_address = self.chamber.address
            self.contact_number = self.chamber.contact_number
        super().save(*args, **kwargs)

    def __str__(self):
        return self.full_doctor_title

    def hospital_cut(self, fee):
        fee = Decimal(fee)
        if self.hospital_share_mode == 'fixed':
            return min(fee, self.hospital_share_value)
        return min(fee, (fee * self.hospital_share_value / 100).quantize(Decimal('0.01')))


class WeeklyAvailability(models.Model):
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.CASCADE, related_name='weekly')
    weekday = models.PositiveSmallIntegerField(choices=[(i, d) for i, d in enumerate(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])])
    start_time = models.TimeField()
    end_time = models.TimeField()
    duration_minutes = models.PositiveSmallIntegerField(default=30, validators=[MinValueValidator(5), MaxValueValidator(240)])
    capacity = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(100)])
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['weekday', 'start_time']

    def __str__(self):
        return f'{self.doctor} · {self.get_weekday_display()} · {self.start_time}–{self.end_time}'


class AppointmentSlot(models.Model):
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.CASCADE, related_name='slots')
    template = models.ForeignKey(WeeklyAvailability, on_delete=models.SET_NULL, null=True, blank=True, related_name='slots')
    date = models.DateField(db_index=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    capacity = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1)])
    is_open = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'start_time']
        constraints = [models.UniqueConstraint(fields=['doctor','date','start_time'], name='unique_doctor_slot')]

    @property
    def reserved(self):
        return self.appointments.exclude(status__in=['cancelled','expired']).count()

    @property
    def remaining(self):
        return max(0, self.capacity - self.reserved)

    @property
    def next_serial_number(self):
        return self.reserved + 1

    @property
    def is_full(self):
        return self.remaining <= 0

    def __str__(self):
        return f'{self.doctor} · {self.date} {self.start_time:%H:%M}'


class Appointment(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Awaiting payment'
        CONFIRMED = 'confirmed', 'Confirmed'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        EXPIRED = 'expired', 'Payment deadline passed'
        NO_SHOW = 'no_show', 'Did not attend'
    class Visit(models.TextChoices):
        FIRST = 'first', 'First Visit / New Patient'
        FOLLOWUP = 'followup', 'Second Visit / Follow-up'
        REPORT = 'report', 'Report Review'
    reference = models.CharField(max_length=20, unique=True, editable=False, db_index=True)
    serial_number = models.PositiveIntegerField(default=1, help_text="Patient consultation serial number")
    slot = models.ForeignKey(AppointmentSlot, on_delete=models.PROTECT, related_name='appointments')
    patient = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name='appointments')
    guest_name = models.CharField(max_length=150)
    guest_phone = models.CharField(max_length=16, validators=[phone_validator], db_index=True)
    guest_dob = models.DateField(null=True, blank=True)
    visit_type = models.CharField(max_length=10, choices=Visit.choices, default=Visit.FIRST)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.CONFIRMED, db_index=True)
    payment_status = models.CharField(max_length=20, choices=[('unpaid','Unpaid'),('paid','Paid'),('refund_pending','Refund pending'),('partially_refunded','Partly refunded'),('refunded','Refunded')], default='unpaid', db_index=True)
    payment_method = models.CharField(max_length=10, choices=[('cash','Cash / at reception'),('online','Online')], default='cash')
    source = models.CharField(max_length=10, choices=[('web','Patient portal'),('phone','Telephone'),('desk','Reception desk')], default='web')
    fee = models.DecimalField(max_digits=9, decimal_places=2, validators=[money_min])
    cancel_mode_snapshot = models.CharField(max_length=10, choices=[('percent','Percentage'),('fixed','Fixed amount')], default='percent')
    cancel_value_snapshot = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal('0.00'), validators=[money_min])
    hospital_cut = models.DecimalField(max_digits=9, decimal_places=2, default=0)
    doctor_cut = models.DecimalField(max_digits=9, decimal_places=2, default=0)
    payment_due_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    cancellation_reason = models.TextField(blank=True)
    cancelled_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='cancelled_appointments')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='booked_appointments')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.reference:
            import random, string
            while True:
                code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
                if not Appointment.objects.filter(reference__iexact=code).exists():
                    self.reference = code
                    break
        super().save(*args, **kwargs)

    @property
    def doctor(self):
        return self.slot.doctor

    @property
    def patient_name(self):
        return self.patient.display_name if self.patient_id else self.guest_name

    def __str__(self):
        return self.reference


class PaymentTransaction(models.Model):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name='payments')
    kind = models.CharField(max_length=8, choices=[('charge','Charge'),('refund','Refund')], default='charge')
    method = models.CharField(max_length=12, choices=[('cash','Cash'),('online','SSLCOMMERZ'),('bank','Bank transfer')])
    status = models.CharField(max_length=14, choices=[('initiated','Initiated'),('verified','Verified'),('failed','Failed'),('processing','Processing'),('refunded','Refunded')], default='initiated')
    amount = models.DecimalField(max_digits=9, decimal_places=2, validators=[money_min])
    external_id = models.CharField(max_length=40, unique=True, null=True, blank=True)
    validation_id = models.CharField(max_length=90, blank=True)
    bank_transaction_id = models.CharField(max_length=90, blank=True)
    refund_reference = models.CharField(max_length=90, blank=True)
    handled_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class RefundRequest(models.Model):
    appointment = models.OneToOneField(Appointment, on_delete=models.PROTECT, related_name='refund')
    amount = models.DecimalField(max_digits=9, decimal_places=2, validators=[money_min])
    mode = models.CharField(max_length=10, choices=[('cash','Cash'),('online','Online gateway')])
    status = models.CharField(max_length=12, choices=[('pending','Pending approval'),('approved','Approved'),('processing','Processing'),('completed','Completed'),('rejected','Rejected')], default='pending')
    requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='requested_refunds')
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='reviewed_refunds')
    reason = models.TextField(blank=True)
    internal_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'{self.appointment.reference}: {self.amount}'


class Complaint(models.Model):
    ticket_code = models.CharField(max_length=12, blank=True, db_index=True)
    patient = models.ForeignKey(User, on_delete=models.PROTECT, related_name='complaints')
    appointment = models.ForeignKey(Appointment, on_delete=models.SET_NULL, null=True, blank=True)
    subject = models.CharField(max_length=150)
    category = models.CharField(
        max_length=20,
        choices=[
            ('support', 'General Support & Help'),
            ('doctor', 'Doctor & Consultation'),
            ('hospital', 'Hospital Facilities'),
            ('staff', 'Staff & Reception'),
            ('billing', 'Billing & Payment'),
            ('other', 'Other Issue'),
        ],
        default='support'
    )
    message = models.TextField()
    attachment = models.FileField(upload_to='complaints/patient/', blank=True, null=True)
    status = models.CharField(
        max_length=20,
        choices=[
            ('submitted', 'Complaint Generated'),
            ('reviewing', 'Under Review & Inquiring'),
            ('resolved', 'Issue Solved'),
        ],
        default='submitted'
    )
    response = models.TextField(blank=True)
    admin_attachment = models.FileField(upload_to='complaints/admin/', blank=True, null=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='handled_complaints')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.ticket_code:
            import random, string
            while True:
                chars = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
                if not Complaint.objects.filter(ticket_code__iexact=chars).exists():
                    self.ticket_code = chars
                    break
        super().save(*args, **kwargs)

    @property
    def display_code(self):
        if self.ticket_code:
            return self.ticket_code.replace('TK-', '').replace('-', '').upper()
        return f"{self.pk:06d}"

    @property
    def is_support(self):
        return self.category == 'support'

    @property
    def status_step(self):
        if self.status == 'submitted':
            return 1
        elif self.status == 'reviewing':
            return 2
        elif self.status == 'resolved':
            return 3
        return 1

    @property
    def step_label(self):
        if self.status == 'submitted':
            return 'Support Help Generated' if self.is_support else 'Complaint Generated'
        elif self.status == 'reviewing':
            return 'Under Review & Inquiring'
        elif self.status == 'resolved':
            return 'Issue Solved'
        return self.get_status_display()


class ComplaintMessage(models.Model):
    complaint = models.ForeignKey(Complaint, on_delete=models.CASCADE, related_name='messages')
    author = models.ForeignKey(User, on_delete=models.PROTECT, related_name='complaint_messages')
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.author.display_name}: {self.message[:35]}"


class AuditEvent(models.Model):
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=100)
    target = models.CharField(max_length=160)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    ACTION_MAP = {
        'appointment.created': ('Booking Created', 'Booking', 'status-confirmed', 'ic-calendar'),
        'appointment.confirmed': ('Booking Confirmed', 'Booking', 'status-confirmed', 'ic-check'),
        'appointment.completed': ('Consultation Completed', 'Booking', 'status-completed', 'ic-check'),
        'appointment.cancelled': ('Booking Cancelled', 'Booking', 'status-cancelled', 'ic-x'),
        'appointment.expired': ('Booking Expired', 'Booking', 'status-expired', 'ic-clock'),
        'appointment.patient_linked': ('Patient Account Linked', 'Booking', 'status-info', 'ic-user'),
        'payment.cash_verified': ('Cash Payment Verified', 'Finance', 'status-confirmed', 'ic-wallet'),
        'payment.gateway_verified': ('Online Payment Confirmed', 'Finance', 'status-confirmed', 'ic-wallet'),
        'payment.gateway_started': ('Online Payment Initiated', 'Finance', 'status-info', 'ic-wallet'),
        'refund.approved': ('Refund Approved', 'Finance', 'status-purple', 'ic-wallet'),
        'refund.cash_disbursed': ('Cash Refund Paid', 'Finance', 'status-purple', 'ic-wallet'),
        'refund.gateway_submitted': ('Gateway Refund Sent', 'Finance', 'status-purple', 'ic-wallet'),
        'refund.gateway_confirmed': ('Gateway Refund Settled', 'Finance', 'status-purple', 'ic-wallet'),
        'patient.registered': ('Patient Registered', 'Account', 'status-info', 'ic-user'),
        'profile.updated': ('Profile Information Updated', 'Account', 'status-info', 'ic-user'),
        'staff.saved': ('Staff Account Saved', 'Account', 'status-info', 'ic-users'),
        'schedule.updated': ('Schedule Updated', 'Schedule', 'status-teal', 'ic-calendar'),
        'schedule.weekly_removed': ('Weekly Slot Removed', 'Schedule', 'status-cancelled', 'ic-calendar'),
        'schedule.copied': ('Schedule Cloned', 'Schedule', 'status-info', 'ic-calendar'),
        'slot.saved': ('Consultation Slot Saved', 'Schedule', 'status-teal', 'ic-calendar'),
        'slot.open_changed': ('Slot Availability Toggled', 'Schedule', 'status-amber', 'ic-calendar'),
        'chamber.saved': ('Chamber Location Updated', 'Management', 'status-info', 'ic-building'),
        'chamber.deleted': ('Chamber Removed', 'Management', 'status-cancelled', 'ic-building'),
        'department.created': ('Department Created', 'Management', 'status-info', 'ic-building'),
        'doctor.rules_updated': ('Doctor Practice Rules Saved', 'Management', 'status-teal', 'ic-settings'),
        'hospital.policy_defaults': ('Hospital Policy Updated', 'Management', 'status-teal', 'ic-settings'),
        'complaint.submitted': ('Ticket / Request Logged', 'Support', 'status-amber', 'ic-alert'),
        'complaint.updated': ('Ticket Status Updated', 'Support', 'status-teal', 'ic-alert'),
        'complaint.patient_reply': ('Patient Reply Received', 'Support', 'status-info', 'ic-user'),
        'complaint.inquired': ('Hospital Inquiry Sent', 'Support', 'status-teal', 'ic-help'),
        'complaint.resolved': ('Ticket Issue Solved', 'Support', 'status-confirmed', 'ic-check'),
        'report.exported': ('Financial Report Exported', 'Analytics', 'status-slate', 'ic-chart'),
    }

    @property
    def action_label(self):
        item = self.ACTION_MAP.get(self.action)
        if item:
            return item[0]
        return self.action.replace('.', ' · ').replace('_', ' ').title()

    @property
    def action_category(self):
        item = self.ACTION_MAP.get(self.action)
        if item:
            return item[1]
        return self.action.split('.')[0].capitalize() if '.' in self.action else 'System'

    @property
    def action_badge_class(self):
        item = self.ACTION_MAP.get(self.action)
        return item[2] if item else 'status-slate'

    @property
    def action_icon(self):
        item = self.ACTION_MAP.get(self.action)
        return item[3] if item else 'ic-activity'

    @property
    def actor_info(self):
        if not self.actor:
            return {
                'name': 'System Automation',
                'role': 'Automated Task',
                'initial': 'SYS',
                'is_system': True,
                'role_class': 'role-pill-system'
            }
        role_label = {
            'admin': 'Admin',
            'doctor': 'Doctor',
            'receptionist': 'Reception',
            'patient': 'Patient'
        }.get(self.actor.role, self.actor.role.title())
        first = (self.actor.first_name or '')[:1].upper()
        last = (self.actor.last_name or '')[:1].upper()
        initial = (first + last) if (first or last) else self.actor.username[:2].upper()
        return {
            'name': self.actor.display_name,
            'role': role_label,
            'initial': initial,
            'is_system': False,
            'role_class': f'role-pill-{self.actor.role}'
        }

    @property
    def formatted_target(self):
        t = str(self.target or '').strip()
        if t.startswith('GH-'):
            return {'is_appointment': True, 'label': t, 'ref': t}
        return {'is_appointment': False, 'label': t or '—', 'ref': ''}

    @property
    def clean_detail(self):
        d = str(self.detail or '').strip()
        if not d:
            return 'Action completed successfully.'
        if 'doctor_side=' in d:
            parts = [p.strip() for p in d.split(';') if p.strip()]
            reason_part = next((p.replace('reason=', '').strip() for p in parts if p.startswith('reason=')), '')
            by = 'Doctor cancellation' if 'doctor_side=True' in d else 'Patient cancellation'
            return f"{by} ({reason_part})" if reason_part else by
        if ' BDT' in d:
            return d.replace(' BDT', ' ৳')
        return d
