from django.contrib.auth.mixins import LoginRequiredMixin
from accounts.decorators import (
    DoctorRequiredMixin,
    PatientRequiredMixin,
    ReceptionistRequiredMixin,
    HospitalAdminRequiredMixin,
    SuperAdminRequiredMixin,
    AdminRequiredMixin,
    RefundApprovalPermissionMixin,
)

__all__ = [
    "PatientRequiredMixin",
    "DoctorRequiredMixin",
    "ReceptionistRequiredMixin",
    "HospitalAdminRequiredMixin",
    "SuperAdminRequiredMixin",
    "AdminRequiredMixin",
    "RefundApprovalPermissionMixin",
]
