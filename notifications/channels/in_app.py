import logging
from typing import Optional
from accounts.models import User
from notifications.models import Notification
from notifications.channels.base import BaseNotificationChannel

logger = logging.getLogger(__name__)


class InAppNotificationChannel(BaseNotificationChannel):
    """
    Standard In-App notification channel.
    Creates an immutable database record with read status and deduplication support.
    """

    @property
    def channel_name(self) -> str:
        return "in_app"

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
        try:
            if deduplication_key:
                # Check if notification with this deduplication key already exists
                existing = Notification.objects.filter(deduplication_key=deduplication_key).first()
                if existing:
                    logger.info(
                        f"Skipping duplicate in-app notification with key '{deduplication_key}'."
                    )
                    return True

            Notification.objects.create(
                recipient=recipient,
                notification_type=notification_type,
                title=title,
                message=message,
                related_link=related_link,
                deduplication_key=deduplication_key,
            )
            return True
        except Exception as e:
            logger.error(f"Error creating in-app notification: {e}", exc_info=True)
            return False
