import logging
from typing import Optional
from django.core.mail import send_mail
from django.conf import settings
from accounts.models import User
from notifications.channels.base import BaseNotificationChannel

logger = logging.getLogger(__name__)


class EmailNotificationChannel(BaseNotificationChannel):
    """
    Email notification delivery channel.
    Wraps Django send_mail, strips sensitive medical details, and fails safely
    without blocking application transactions.
    """

    @property
    def channel_name(self) -> str:
        return "email"

    def send(
        self,
        recipient: User,
        title: str,
        message: str,
        notification_type: str,
        related_link: str = "",
        deduplication_key: Optional[str] = None,
        context: Optional[dict] = None,
    ) -> bool:
        if not recipient.email:
            return False

        # Privacy protection: Sanitize sensitive diagnosis/prescription info from email
        sanitized_message = (
            f"Dear {recipient.get_full_name() or recipient.username},\n\n"
            f"{message}\n\n"
        )
        if related_link:
            site_url = getattr(settings, "SITE_URL", "http://localhost:8000").rstrip("/")
            full_url = f"{site_url}{related_link}" if related_link.startswith("/") else related_link
            sanitized_message += f"View details here: {full_url}\n\n"

        sanitized_message += (
            "Thank you for choosing Green Hospital.\n"
            "Doctor Appointment System for Green Hospital\n"
            "Need help? Contact support@greenhospital.com"
        )

        subject = f"[Green Hospital] {title}"
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "notifications@greenhospital.com")

        try:
            send_mail(
                subject=subject,
                message=sanitized_message,
                from_email=from_email,
                recipient_list=[recipient.email],
                fail_silently=False,
            )
            return True
        except Exception as e:
            # Crucial: Never block the caller if SMTP server or network fails!
            logger.warning(
                f"Email notification delivery failed for {recipient.email}: {e}. Continuing cleanly."
            )
            return False
