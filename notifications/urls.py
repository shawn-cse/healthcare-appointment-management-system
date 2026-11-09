from django.urls import path
from notifications.views import (
    NotificationListView,
    MarkNotificationReadView,
    MarkAllNotificationsReadView,
)

app_name = "notifications"

urlpatterns = [
    path("", NotificationListView.as_view(), name="list"),
    path("<int:pk>/read/", MarkNotificationReadView.as_view(), name="mark-read"),
    path("read-all/", MarkAllNotificationsReadView.as_view(), name="mark-all-read"),
]
