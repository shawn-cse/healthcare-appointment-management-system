from django.shortcuts import get_object_or_404, redirect
from django.views import View
from django.views.generic import ListView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse, HttpResponseRedirect
from django.urls import reverse
from django.utils import timezone
from django.contrib import messages

from notifications.models import Notification


class NotificationListView(LoginRequiredMixin, ListView):
    """
    User notification center showing notifications with read/unread statuses.
    """
    model = Notification
    template_name = "notifications/notification_list.html"
    context_object_name = "notifications"
    paginate_by = 20

    def get_queryset(self):
        qs = Notification.objects.filter(recipient=self.request.user)
        filter_type = self.request.GET.get("filter")
        if filter_type == "unread":
            qs = qs.filter(is_read=False)
        return qs

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["unread_count"] = Notification.objects.filter(
            recipient=self.request.user, is_read=False
        ).count()
        ctx["active_filter"] = self.request.GET.get("filter", "all")
        return ctx


class MarkNotificationReadView(LoginRequiredMixin, View):
    """
    Marks a single notification as read. Supports both AJAX JSON responses and form redirects.
    """
    def post(self, request, pk):
        notif = get_object_or_404(Notification, pk=pk, recipient=request.user)
        notif.mark_as_read()

        if request.headers.get("x-requested-with") == "XMLHttpRequest":
            return JsonResponse({"status": "success", "is_read": True})

        next_url = request.POST.get("next") or request.GET.get("next") or reverse("notifications:list")
        if notif.related_link and request.POST.get("redirect_to_target") == "true":
            return redirect(notif.related_link)
        return HttpResponseRedirect(next_url)


class MarkAllNotificationsReadView(LoginRequiredMixin, View):
    """
    Marks all notifications for the active user as read.
    """
    def post(self, request):
        now = timezone.now()
        updated_count = Notification.objects.filter(
            recipient=request.user, is_read=False
        ).update(is_read=True, read_at=now)

        if request.headers.get("x-requested-with") == "XMLHttpRequest":
            return JsonResponse({"status": "success", "updated_count": updated_count})

        messages.success(request, f"Marked {updated_count} notification(s) as read.")
        return redirect("notifications:list")
