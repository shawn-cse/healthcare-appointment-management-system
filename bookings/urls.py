from django.urls import path

from .views import (
    BookingView,
    BookingCreateView,
    BookingSuccessView,
    BookingInvoiceView,
    BookingListView,
    BookingPricingQuoteView,
)

app_name = "bookings"

urlpatterns = [
    path(
        "doctor/<slug:username>",
        BookingView.as_view(),
        name="doctor-booking-view",
    ),
    path(
        "create/<str:username>/",
        BookingCreateView.as_view(),
        name="create-booking",
    ),
    path(
        "<int:booking_id>/success/",
        BookingSuccessView.as_view(),
        name="booking-success",
    ),
    path(
        "<int:booking_id>/invoice/",
        BookingInvoiceView.as_view(),
        name="booking-invoice",
    ),
    path(
        "list/",
        BookingListView.as_view(),
        name="booking-list",
    ),
    path(
        "api/pricing-quote/",
        BookingPricingQuoteView.as_view(),
        name="pricing-quote",
    ),
    path(
        "api/pricing_quote/",
        BookingPricingQuoteView.as_view(),
        name="pricing_quote",
    ),
]
