import os
from django.core.management.base import BaseCommand
from accounts.models import User, AuditLog, log_audit_event


class Command(BaseCommand):
    help = "Securely initialize or promote a Green Hospital Super Admin account"

    def add_arguments(self, parser):
        parser.add_argument("--username", type=str, default="admin", help="Super Admin username")
        parser.add_argument("--email", type=str, default="admin@greenhospital.com", help="Super Admin email")
        parser.add_argument("--password", type=str, default=None, help="Super Admin password")

    def handle(self, *args, **options):
        username = options["username"]
        email = options["email"]
        password = options["password"]

        user, created = User.objects.get_or_create(username=username, defaults={"email": email})

        user.role = User.RoleChoices.SUPER_ADMIN
        user.status = User.StatusChoices.ACTIVE
        user.is_staff = True
        user.is_superuser = True
        user.email = email

        if password:
            user.set_password(password)
        elif created:
            default_pwd = os.environ.get("INITIAL_SUPERADMIN_PASSWORD", "Admin@123456")
            user.set_password(default_pwd)
            self.stdout.write(
                self.style.WARNING(
                    f"No password provided. Initial default password set to: {default_pwd}"
                )
            )

        user.save()

        log_audit_event(
            actor=user,
            action=AuditLog.ActionChoices.STAFF_PRIVILEGE_CHANGE,
            target_user=user,
            details={"action": "superadmin_initialization", "created": created},
        )

        status_action = "created" if created else "promoted to Super Admin"
        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully {status_action} Super Admin user '{username}' (role=super_admin, is_superuser=True)."
            )
        )
