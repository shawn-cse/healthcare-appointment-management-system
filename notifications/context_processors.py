from notifications.models import Notification


def notifications_processor(request):
    """
    Supplies unread notification count and latest notifications to template context.
    """
    if not hasattr(request, "user") or not request.user.is_authenticated:
        return {
            "unread_notifications_count": 0,
            "recent_notifications": [],
        }

    unread_count = Notification.objects.filter(
        recipient=request.user,
        is_read=False,
    ).count()

    recent = Notification.objects.filter(
        recipient=request.user,
    )[:5]

    return {
        "unread_notifications_count": unread_count,
        "recent_notifications": recent,
    }
