# backend/travel_agent/api/urls.py
from django.urls import path
from .views import SearchPackagesView, PackageDetailView, CheckAvailabilityView

app_name = "travel_agent"

urlpatterns = [
    path("search-packages/", SearchPackagesView.as_view(), name="search-packages"),
    path(
        "packages/<str:offer_id>/", PackageDetailView.as_view(), name="package-detail"
    ),
    path(
        "packages/<str:offer_id>/check-availability/",
        CheckAvailabilityView.as_view(),
        name="check-availability",
    ),
]
