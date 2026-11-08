from datetime import time, timedelta
from django.db import models
from django.conf import settings
from accounts.models import User


class DoctorWeeklySchedule(models.Model):
    """
    Recurring weekly working sessions for doctors.
    Supports multiple sessions per day (e.g., Morning 09:00-12:00, Evening 17:00-20:00),
    custom consultation duration, breaks, and maximum patient capacity.
    """
    class WeekdayChoices(models.IntegerChoices):
        MONDAY = 0, "Monday"
        TUESDAY = 1, "Tuesday"
        WEDNESDAY = 2, "Wednesday"
        THURSDAY = 3, "Thursday"
        FRIDAY = 4, "Friday"
        SATURDAY = 5, "Saturday"
        SUNDAY = 6, "Sunday"

    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="weekly_schedules",
        limit_choices_to={"role": "doctor"},
    )
    weekday = models.IntegerField(choices=WeekdayChoices.choices)
    session_name = models.CharField(max_length=100, default="General Session")
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_duration = models.PositiveIntegerField(
        default=15,
        help_text="Consultation slot duration in minutes (e.g. 10, 15, 20, 30)",
    )
    max_capacity = models.PositiveIntegerField(
        default=20,
        help_text="Maximum appointment capacity per day/session",
    )
    chamber_number = models.CharField(max_length=100, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["weekday", "start_time"]
        verbose_name = "Doctor Weekly Schedule"
        verbose_name_plural = "Doctor Weekly Schedules"

    def __str__(self):
        return (
            f"Dr. {self.doctor.get_full_name()} - {self.get_weekday_display()} "
            f"({self.session_name}: {self.start_time.strftime('%I:%M %p')} - {self.end_time.strftime('%I:%M %p')})"
        )

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValidationError("Schedule start time must be before end time.")
        from doctors.services.availability import check_schedule_overlap
        if self.doctor_id and self.weekday is not None and self.start_time and self.end_time:
            if check_schedule_overlap(self.doctor, self.weekday, self.start_time, self.end_time, exclude_id=self.pk):
                raise ValidationError("This session overlaps with another active schedule for this doctor on the same weekday.")

    def get_slot_duration(self):
        return self.slot_duration


class DoctorScheduleBreak(models.Model):
    """
    Configurable breaks within a recurring doctor schedule (e.g., Lunch, Prayer).
    """
    schedule = models.ForeignKey(
        DoctorWeeklySchedule,
        on_delete=models.CASCADE,
        related_name="breaks",
    )
    name = models.CharField(max_length=100, default="Break")
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ["start_time"]
        verbose_name = "Schedule Break"
        verbose_name_plural = "Schedule Breaks"

    def __str__(self):
        return f"{self.name} ({self.start_time.strftime('%I:%M %p')} - {self.end_time.strftime('%I:%M %p')})"

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValidationError("Break start time must be before end time.")
        if self.schedule:
            if self.start_time < self.schedule.start_time or self.end_time > self.schedule.end_time:
                raise ValidationError("Break must fall within the session's operating hours.")


class DoctorAvailabilityException(models.Model):
    """
    Exceptions to recurring schedules:
    - Day off / Not Available for specific date
    - Blocked time interval
    - Holiday or temporary leave
    - Blocked consultation session
    """
    class ExceptionType(models.TextChoices):
        DAY_OFF = "day_off", "Not Available / Day Off"
        HOLIDAY = "holiday", "Holiday / Leave"
        BLOCKED_INTERVAL = "blocked_interval", "Blocked Time Interval"
        BLOCKED_SESSION = "blocked_session", "Blocked Consultation Session"

    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="availability_exceptions",
        limit_choices_to={"role": "doctor"},
    )
    exception_type = models.CharField(
        max_length=30,
        choices=ExceptionType.choices,
        default=ExceptionType.DAY_OFF,
    )
    start_date = models.DateField()
    end_date = models.DateField(help_text="Inclusive end date")
    start_time = models.TimeField(null=True, blank=True, help_text="Required for blocked intervals")
    end_time = models.TimeField(null=True, blank=True, help_text="Required for blocked intervals")
    reason = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date", "-created_at"]
        verbose_name = "Doctor Availability Exception"
        verbose_name_plural = "Doctor Availability Exceptions"

    def __str__(self):
        return (
            f"Dr. {self.doctor.get_full_name()} - {self.get_exception_type_display()} "
            f"({self.start_date} to {self.end_date})"
        )


class HospitalSetting(models.Model):
    """
    Global operational settings for Green Hospital, including configurable booking window.
    """
    booking_window_hours = models.PositiveIntegerField(
        default=48,
        help_text="Default 48 hours advance booking window policy",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Hospital Setting"
        verbose_name_plural = "Hospital Settings"

    def __str__(self):
        return f"Green Hospital Configuration (Booking Window: {self.booking_window_hours}h)"

    @classmethod
    def get_booking_window_hours(cls) -> int:
        obj = cls.objects.first()
        return obj.booking_window_hours if obj else 48
