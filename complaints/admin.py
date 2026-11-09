from django.contrib import admin
from complaints.models import Complaint


@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    list_display = ["reference", "patient", "doctor", "category", "status", "created_at"]
    list_filter = ["status", "category", "created_at"]
    search_fields = ["reference", "patient__username", "doctor__username", "subject", "description"]
    readonly_fields = ["reference", "created_at", "updated_at"]
