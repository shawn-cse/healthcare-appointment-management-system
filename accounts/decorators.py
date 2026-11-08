from functools import wraps
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import PermissionDenied
from django.shortcuts import redirect


class RoleRequiredMixin(LoginRequiredMixin):
    """
    Mixin ensuring user has at least one of the permitted roles (or is Super Admin).
    """
    allowed_roles = []

    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if request.user.is_super_admin or request.user.role in self.allowed_roles:
            return super().dispatch(request, *args, **kwargs)
        messages.error(request, "You are not authorized to access this page.")
        return redirect("core:home")


class SuperAdminRequiredMixin(LoginRequiredMixin):
    """Only Super Admin can access."""
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if not request.user.is_super_admin:
            messages.error(
                request, "Super Administrator access required."
            )
            return redirect("core:home")
        return super().dispatch(request, *args, **kwargs)


class AdminRequiredMixin(LoginRequiredMixin):
    """
    Permits Super Admin and Hospital Admin (staff administration).
    """
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if not request.user.is_staff_admin:
            messages.error(
                request, "You are not authorized to access administrative areas."
            )
            return redirect("core:home")
        return super().dispatch(request, *args, **kwargs)


class HospitalAdminRequiredMixin(AdminRequiredMixin):
    """Permits Hospital Admin and Super Admin."""
    pass


class DoctorRequiredMixin(LoginRequiredMixin):
    """Permits only doctors."""
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if not request.user.is_doctor:
            messages.error(request, "Doctor access required.")
            return redirect("core:home")
        return super().dispatch(request, *args, **kwargs)


class ReceptionistRequiredMixin(LoginRequiredMixin):
    """Permits only receptionists."""
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if not request.user.is_receptionist:
            messages.error(request, "Receptionist access required.")
            return redirect("core:home")
        return super().dispatch(request, *args, **kwargs)


class PatientRequiredMixin(LoginRequiredMixin):
    """Permits only patients."""
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if not request.user.is_patient:
            messages.error(request, "Patient access required.")
            return redirect("core:home")
        return super().dispatch(request, *args, **kwargs)


class RefundApprovalPermissionMixin(LoginRequiredMixin):
    """
    Only SUPER_ADMIN / admin has final refund approval.
    Hospital Administrators cannot approve refunds.
    """
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        if not request.user.can_approve_refunds:
            raise PermissionDenied(
                "Hospital Administrators and other staff cannot approve refunds. Only Super Admin has refund approval authority."
            )
        return super().dispatch(request, *args, **kwargs)


def role_required(*allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect("accounts:login")
            if request.user.is_super_admin or request.user.role in allowed_roles:
                return view_func(request, *args, **kwargs)
            raise PermissionDenied("You do not have permission to access this resource.")
        return _wrapped_view
    return decorator


def super_admin_required(view_func):
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect("accounts:login")
        if not request.user.is_super_admin:
            raise PermissionDenied("Super Administrator access required.")
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def hospital_admin_required(view_func):
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect("accounts:login")
        if not request.user.is_staff_admin:
            raise PermissionDenied("Hospital Administration access required.")
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def refund_approval_required(view_func):
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect("accounts:login")
        if not request.user.can_approve_refunds:
            raise PermissionDenied(
                "Hospital Administrators cannot approve refunds. Only Super Admin has refund approval authority."
            )
        return view_func(request, *args, **kwargs)
    return _wrapped_view
