from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

from accounts.views.admin_views import (
    AdminDashboardView,
    AdminPatientsView,
    AdminDoctorsView,
    AdminAppointmentsView,
    AdminSpecialitiesView,
    SpecialityCreateView,
    SpecialityUpdateView,
    SpecialityDeleteView,
    AdminPrescriptionsView,
    AdminReviewListView,
    AppointmentReportView,
    RevenueReportView,
    StaffManagementListView,
    StaffRoleChangeView,
    ReceptionistAssignmentListView,
    ReceptionistAssignDoctorView,
    ReceptionistUnassignDoctorView,
    AuditLogListView,
    RefundApprovalView,
    DoctorApprovalListView,
    DoctorApprovalDetailView,
    DoctorApproveActionView,
    DoctorRejectActionView,
    DoctorSuspendReactivateView,
    DoctorBMDCVerifyActionView,
    HospitalSettingsUpdateView,
)

admin.site.site_header = "Green Hospital Admin"
admin.site.site_title = "Green Hospital Admin Portal"
admin.site.index_title = "Welcome to Green Hospital Admin Portal"


urlpatterns = (
    [
        path("super-admin/", admin.site.urls),
        path("accounts/", include("accounts.urls")),
        path("patients/", include("patients.urls")),
        path("doctors/", include("doctors.urls")),
        path("bookings/", include("bookings.urls")),
        path("payments/", include("payments.urls")),
        path("notifications/", include("notifications.urls")),
        path("complaints/", include("complaints.urls")),
        path("", include("core.urls")),
        path("ckeditor/", include("ckeditor_uploader.urls")),
        path(
            "admin/",
            include(
                [
                    path(
                        "",
                        AdminDashboardView.as_view(),
                        name="admin-dashboard",
                    ),
                    path(
                        "patients/",
                        AdminPatientsView.as_view(),
                        name="admin-patients",
                    ),
                    path(
                        "doctors/",
                        AdminDoctorsView.as_view(),
                        name="admin-doctors",
                    ),
                    path(
                        "appointments/",
                        AdminAppointmentsView.as_view(),
                        name="admin-appointments",
                    ),
                    path(
                        "appointments/<int:booking_id>/refund-approve/",
                        RefundApprovalView.as_view(),
                        name="admin-refund-approve",
                    ),
                    path(
                        "specialities/",
                        AdminSpecialitiesView.as_view(),
                        name="admin-specialities",
                    ),
                    path(
                        "specialities/create/",
                        SpecialityCreateView.as_view(),
                        name="admin-speciality-create",
                    ),
                    path(
                        "specialities/<int:pk>/update/",
                        SpecialityUpdateView.as_view(),
                        name="admin-speciality-update",
                    ),
                    path(
                        "specialities/<int:pk>/delete/",
                        SpecialityDeleteView.as_view(),
                        name="admin-speciality-delete",
                    ),
                    path(
                        "prescriptions/",
                        AdminPrescriptionsView.as_view(),
                        name="admin-prescriptions",
                    ),
                    path(
                        "reviews/",
                        AdminReviewListView.as_view(),
                        name="admin-reviews",
                    ),
                    path(
                        "reports/appointments/",
                        AppointmentReportView.as_view(),
                        name="admin-appointment-report",
                    ),
                    path(
                        "reports/revenue/",
                        RevenueReportView.as_view(),
                        name="admin-revenue-report",
                    ),
                    path(
                        "staff/",
                        StaffManagementListView.as_view(),
                        name="admin-staff-management",
                    ),
                    path(
                        "staff/<int:pk>/role/",
                        StaffRoleChangeView.as_view(),
                        name="admin-staff-role-change",
                    ),
                    path(
                        "receptionists/assignments/",
                        ReceptionistAssignmentListView.as_view(),
                        name="admin-receptionist-assignments",
                    ),
                    path(
                        "receptionists/assignments/assign/",
                        ReceptionistAssignDoctorView.as_view(),
                        name="admin-receptionist-assign",
                    ),
                    path(
                        "receptionists/assignments/<int:pk>/delete/",
                        ReceptionistUnassignDoctorView.as_view(),
                        name="admin-receptionist-unassign",
                    ),
                    path(
                        "audit-logs/",
                        AuditLogListView.as_view(),
                        name="admin-audit-logs",
                    ),
                    path(
                        "settings/booking-window/",
                        HospitalSettingsUpdateView.as_view(),
                        name="admin-settings-booking-window",
                    ),
                    # Doctor Approvals & Moderation
                    path(
                        "doctor-approvals/",
                        DoctorApprovalListView.as_view(),
                        name="admin-doctor-approvals",
                    ),
                    path(
                        "doctor-approvals/<int:pk>/",
                        DoctorApprovalDetailView.as_view(),
                        name="admin-doctor-approval-detail",
                    ),
                    path(
                        "doctor-approvals/<int:pk>/approve/",
                        DoctorApproveActionView.as_view(),
                        name="admin-doctor-approve",
                    ),
                    path(
                        "doctor-approvals/<int:pk>/reject/",
                        DoctorRejectActionView.as_view(),
                        name="admin-doctor-reject",
                    ),
                    path(
                        "doctor-approvals/<int:pk>/status/<str:action>/",
                        DoctorSuspendReactivateView.as_view(),
                        name="admin-doctor-suspend-reactivate",
                    ),
                    path(
                        "doctor-approvals/<int:pk>/verify-bmdc/",
                        DoctorBMDCVerifyActionView.as_view(),
                        name="admin-doctor-verify-bmdc",
                    ),
                ],
            ),
        ),
    ]
    + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    + static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
)

if settings.DEBUG and "debug_toolbar" in settings.INSTALLED_APPS:
    try:
        import debug_toolbar
        urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
    except ImportError:
        pass
