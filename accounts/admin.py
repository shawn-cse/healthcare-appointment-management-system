from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.core.exceptions import PermissionDenied
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from .models import (
    User,
    Profile,
    ReceptionistDoctorAssignment,
    AuditLog,
    log_audit_event,
)


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ["username", "role", "status", "is_staff", "is_superuser"]
    list_filter = ("role", "status", "is_staff", "is_superuser")
    search_fields = (
        "first_name",
        "last_name",
        "username",
        "email",
    )
    fieldsets = (
        (None, {"fields": ("username", "password", "role", "status")}),
        (_("Personal info"), {"fields": ("first_name", "last_name", "email", "registration_number")}),
        (
            _("Permissions"),
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "password1", "password2", "role", "status"),
            },
        ),
    )

    def save_model(self, request, obj, form, change):
        if change:
            orig = User.objects.get(pk=obj.pk)
            # Only Super Admin can change privileged roles or grant staff/superuser
            privileged_roles = [
                User.RoleChoices.SUPER_ADMIN,
                User.RoleChoices.HOSPITAL_ADMIN,
                User.RoleChoices.RECEPTIONIST,
            ]
            if not request.user.is_super_admin:
                if obj.role in privileged_roles and obj.role != orig.role:
                    raise PermissionDenied("Only Super Admin can grant privileged staff roles.")
                if obj.is_staff != orig.is_staff or obj.is_superuser != orig.is_superuser:
                    raise PermissionDenied("Only Super Admin can alter staff or superuser permissions.")

            # Audit logging
            if obj.role != orig.role:
                log_audit_event(
                    actor=request.user,
                    action=AuditLog.ActionChoices.ROLE_CHANGE,
                    target_user=obj,
                    details={"old_role": orig.role, "new_role": obj.role},
                )
            if obj.status != orig.status:
                log_audit_event(
                    actor=request.user,
                    action=AuditLog.ActionChoices.STATUS_CHANGE,
                    target_user=obj,
                    details={"old_status": orig.status, "new_status": obj.status},
                )
            if obj.is_staff != orig.is_staff or obj.is_superuser != orig.is_superuser:
                log_audit_event(
                    actor=request.user,
                    action=AuditLog.ActionChoices.STAFF_PRIVILEGE_CHANGE,
                    target_user=obj,
                    details={
                        "is_staff": obj.is_staff,
                        "is_superuser": obj.is_superuser,
                    },
                )
        super().save_model(request, obj, form, change)


@admin.register(Profile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "phone", "image_tag"]
    search_fields = ["user__username", "user__first_name", "user__last_name", "phone"]

    def image_tag(self, obj):
        return format_html('<img src="{}" width="60px" />'.format(obj.image))

    image_tag.short_description = "Avatar"
    image_tag.allow_tags = True


@admin.register(ReceptionistDoctorAssignment)
class ReceptionistDoctorAssignmentAdmin(admin.ModelAdmin):
    list_display = ["receptionist", "doctor", "assigned_by", "created_at"]
    list_filter = ["created_at"]
    search_fields = [
        "receptionist__username",
        "doctor__username",
        "doctor__first_name",
        "doctor__last_name",
    ]

    def save_model(self, request, obj, form, change):
        if not obj.assigned_by:
            obj.assigned_by = request.user
        super().save_model(request, obj, form, change)
        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.RECEPTIONIST_ASSIGNED,
            target_user=obj.receptionist,
            details={"doctor": obj.doctor.username, "doctor_id": obj.doctor.id},
        )

    def delete_model(self, request, obj):
        log_audit_event(
            actor=request.user,
            action=AuditLog.ActionChoices.RECEPTIONIST_REMOVED,
            target_user=obj.receptionist,
            details={"doctor": obj.doctor.username, "doctor_id": obj.doctor.id},
        )
        super().delete_model(request, obj)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor", "action", "target_user", "ip_address"]
    list_filter = ["action", "created_at"]
    search_fields = ["actor__username", "target_user__username", "action"]
    readonly_fields = ["created_at", "actor", "target_user", "action", "details", "ip_address"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
