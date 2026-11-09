from django.urls import path
from complaints.views import (
    PatientComplaintCreateView,
    PatientComplaintListView,
    PatientComplaintDetailView,
    AdminComplaintListView,
    AdminComplaintReviewView,
)

app_name = "complaints"

urlpatterns = [
    # Patient complaint endpoints
    path("submit/", PatientComplaintCreateView.as_view(), name="patient-create"),
    path("my-complaints/", PatientComplaintListView.as_view(), name="patient-list"),
    path("my-complaints/<int:pk>/", PatientComplaintDetailView.as_view(), name="patient-detail"),

    # Administrative review endpoints
    path("admin/list/", AdminComplaintListView.as_view(), name="admin-list"),
    path("admin/<int:pk>/review/", AdminComplaintReviewView.as_view(), name="admin-review"),
]
