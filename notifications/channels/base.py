from abc import ABC, abstractmethod
from typing import Optional, Any
from accounts.models import User


class BaseNotificationChannel(ABC):
    """
    Abstract contract for notification delivery channels (In-App, Email, SMS).
    """

    @property
    @abstractmethod
    def channel_name(self) -> str:
        """Identifier for this channel."""
        pass

    @abstractmethod
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
        """
        Sends the notification through this channel.
        Must handle errors gracefully and never raise exceptions that crash callers.
        Returns True if delivered, False otherwise.
        """
        pass
