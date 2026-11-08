from django.urls import path, reverse_lazy
from django.contrib.auth import views as auth_views

from .views.common_views import (
    RegisterDoctorView,
    RegisterPatientView,
    LoginView,
    LogoutView,
    UpdateBasicUserInformationAPIView,
)
from .views.receptionist_views import (
    ReceptionistDashboardView,
    ReceptionistDoctorAppointmentsView,
    ReceptionistCheckInView,
    ReceptionistNoShowView,
    ReceptionistCancelView,
    ReceptionistAddNotesView,
    ReceptionistWalkInBookingView,
)

app_name = "accounts"

urlpatterns = [
    # Public Registration
    path(
        "doctor/register/",
        RegisterDoctorView.as_view(),
        name="doctor-register",
    ),
    path(
        "patient/register/",
        RegisterPatientView.as_view(),
        name="patient-register",
    ),
    # Authentication
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    # Password Reset
    path(
        "password-reset/",
        auth_views.PasswordResetView.as_view(
            template_name="accounts/password_reset.html",
            email_template_name="accounts/password_reset_email.html",
            success_url=reverse_lazy("accounts:password_reset_done"),
        ),
        name="password_reset",
    ),
    path(
        "password-reset/done/",
        auth_views.PasswordResetDoneView.as_view(
            template_name="accounts/password_reset_done.html",
        ),
        name="password_reset_done",
    ),
    path(
        "password-reset-confirm/<uidb64>/<token>/",
        auth_views.PasswordResetConfirmView.as_view(
            template_name="accounts/password_reset_confirm.html",
            success_url=reverse_lazy("accounts:password_reset_complete"),
        ),
        name="password_reset_confirm",
    ),
    path(
        "password-reset-complete/",
        auth_views.PasswordResetCompleteView.as_view(
            template_name="accounts/password_reset_complete.html",
        ),
        name="password_reset_complete",
    ),
    # Receptionist Portal
    path(
        "receptionist/dashboard/",
        ReceptionistDashboardView.as_view(),
        name="receptionist-dashboard",
    ),
    path(
        "receptionist/doctor/<int:doctor_id>/appointments/",
        ReceptionistDoctorAppointmentsView.as_view(),
        name="receptionist-doctor-appointments",
    ),
    path(
        "receptionist/appointment/<int:pk>/check-in/",
        ReceptionistCheckInView.as_view(),
        name="receptionist-check-in",
    ),
    path(
        "receptionist/appointment/<int:pk>/no-show/",
        ReceptionistNoShowView.as_view(),
        name="receptionist-no-show",
    ),
    path(
        "receptionist/appointment/<int:pk>/cancel/",
        ReceptionistCancelView.as_view(),
        name="receptionist-cancel",
    ),
    path(
        "receptionist/appointment/<int:pk>/notes/",
        ReceptionistAddNotesView.as_view(),
        name="receptionist-notes",
    ),
    path(
        "receptionist/walk-in/",
        ReceptionistWalkInBookingView.as_view(),
        name="receptionist-walk-in",
    ),
    path(
        "receptionist/walk-in/<int:doctor_id>/",
        ReceptionistWalkInBookingView.as_view(),
        name="receptionist-walk-in-doctor",
    ),
    # Profile & API
    path(
        "update-basic-information/",
        UpdateBasicUserInformationAPIView.as_view(),
        name="update-basic-information",
    ),
]
