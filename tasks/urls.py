from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import NotificationActionView, NotificationListView, ProfileView, TaskViewSet

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")
urlpatterns = [
    path("profile/", ProfileView.as_view(), name="profile"),
    path("notifications/", NotificationListView.as_view(), name="notifications"),
    path("notifications/read-all/", NotificationActionView.as_view(), {"action_name": "read-all"}, name="notifications-read-all"),
    path("notifications/<int:notification_id>/read/", NotificationActionView.as_view(), {"action_name": "read"}, name="notification-read"),
    path("notifications/<int:notification_id>/unread/", NotificationActionView.as_view(), {"action_name": "unread"}, name="notification-unread"),
    path("notifications/<int:notification_id>/", NotificationActionView.as_view(), name="notification-delete"),
] + router.urls
