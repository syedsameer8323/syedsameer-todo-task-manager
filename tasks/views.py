from datetime import timedelta
from django.db import IntegrityError
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Notification, Task, UserProfile
from .serializers import NotificationSerializer, TaskSerializer, UserProfileSerializer

SORTS = {"newest": "-created_at", "oldest": "created_at", "deadline": "deadline",
         "-deadline": "-deadline", "title": "title", "priority": "priority_rank"}


def create_notification(kind, title, message, event_key, task=None):
    try:
        Notification.objects.get_or_create(
            event_key=event_key,
            defaults={"kind": kind, "title": title, "message": message, "task": task},
        )
    except IntegrityError:
        # A concurrent request may have inserted the same idempotency key.
        pass


def refresh_deadline_notifications():
    """Create one persistent in-app alert per task/deadline condition, without duplicates."""
    today = Task.today()
    active = Task.objects.exclude(status=Task.Status.COMPLETED).filter(deadline__isnull=False)
    for task in active.filter(deadline__lt=today):
        create_notification(Notification.Kind.OVERDUE, "Task overdue",
                            f'"{task.title}" is overdue. Review its deadline or update its status.',
                            f"task:{task.pk}:overdue:{task.deadline}", task)
    for task in active.filter(deadline__range=(today, today + timedelta(days=3))):
        create_notification(Notification.Kind.DUE_SOON, "Deadline coming up",
                            f'"{task.title}" is due on {task.deadline:%d %b %Y}.',
                            f"task:{task.pk}:due-soon:{task.deadline}", task)


class TaskPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    pagination_class = TaskPagination

    def get_queryset(self):
        qs = Task.objects.all()
        p = self.request.query_params
        if p.get("status") in Task.Status.values:
            qs = qs.filter(status=p["status"])
        if p.get("priority") in Task.Priority.values:
            qs = qs.filter(priority=p["priority"])
        if p.get("search", "").strip():
            qs = qs.filter(title__icontains=p["search"].strip())
        if p.get("needs_review") in ("true", "1"):
            qs = qs.filter(needs_review=True)
        elif p.get("needs_review") in ("false", "0"):
            qs = qs.filter(needs_review=False)
        today = Task.today()
        if p.get("due") == "overdue":
            qs = qs.filter(deadline__lt=today).exclude(status=Task.Status.COMPLETED)
        elif p.get("due") == "soon":
            qs = qs.filter(deadline__range=(today, today + timedelta(days=3))).exclude(status=Task.Status.COMPLETED)
        qs = qs.annotate(priority_rank=Case(
            When(priority="high", then=Value(0)), When(priority="medium", then=Value(1)),
            default=Value(2), output_field=IntegerField()))
        return qs.order_by(SORTS.get(p.get("ordering", "newest"), "-created_at"), "-id")

    def create(self, request, *args, **kwargs):
        # Warn on an exact title + description duplicate; the user can explicitly override.
        title = str(request.data.get("title", "")).strip()
        description = " ".join(str(request.data.get("description", "")).split())
        allow_duplicate = str(request.data.get("allow_duplicate", "false")).lower() in ("true", "1", "yes")
        if title and not allow_duplicate:
            candidates = Task.objects.filter(title__iexact=title).order_by("id")
            duplicate = next((t for t in candidates if " ".join((t.description or "").split()) == description), None)
            if duplicate:
                return Response({
                    "error": "A task with the same title and description already exists.",
                    "duplicate": True,
                    "existing_task": {"id": duplicate.pk, "title": duplicate.title},
                }, status=status.HTTP_409_CONFLICT)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        task = serializer.save()
        create_notification(Notification.Kind.TASK_CREATED, "Task created", f'"{task.title}" was added to your tasks.',
                            f"task:{task.pk}:created", task)

    def perform_update(self, serializer):
        old_status = self.get_object().status
        old_review = self.get_object().needs_review
        task = serializer.save()
        if task.status == Task.Status.COMPLETED and old_status != Task.Status.COMPLETED:
            create_notification(Notification.Kind.TASK_COMPLETED, "Task completed", f'"{task.title}" was marked completed.',
                                f"task:{task.pk}:completed:{task.updated_at.isoformat()}", task)
        else:
            create_notification(Notification.Kind.TASK_UPDATED, "Task updated", f'"{task.title}" was updated.',
                                f"task:{task.pk}:updated:{task.updated_at.isoformat()}", task)
        if task.needs_review and not old_review:
            create_notification(Notification.Kind.REVIEW, "Task sent for review", f'"{task.title}" is ready for review.',
                                f"task:{task.pk}:review:{task.updated_at.isoformat()}", task)

    def perform_destroy(self, instance):
        create_notification(Notification.Kind.TASK_DELETED, "Task deleted", f'"{instance.title}" was deleted.',
                            f"task:{instance.pk}:deleted:{timezone.now().isoformat()}", instance)
        instance.delete()

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        """Explicitly accept a pending task and move it into the in-progress workflow."""
        task = self.get_object()
        if task.status != Task.Status.PENDING:
            return Response(
                {"error": "Only pending tasks can be accepted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task.status = Task.Status.IN_PROGRESS
        task.save(update_fields=["status", "updated_at"])
        create_notification(
            Notification.Kind.TASK_UPDATED,
            "Task accepted",
            f'You accepted "{task.title}" and it is now in progress.',
            f"task:{task.pk}:accepted:{task.updated_at.isoformat()}",
            task,
        )
        return Response(TaskSerializer(task).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        today = Task.today()
        open_ = Q(status__in=[Task.Status.PENDING, Task.Status.IN_PROGRESS])
        return Response(Task.objects.aggregate(
            total=Count("id"), pending=Count("id", filter=Q(status=Task.Status.PENDING)),
            in_progress=Count("id", filter=Q(status=Task.Status.IN_PROGRESS)),
            completed=Count("id", filter=Q(status=Task.Status.COMPLETED)),
            overdue=Count("id", filter=open_ & Q(deadline__lt=today)),
            due_soon=Count("id", filter=open_ & Q(deadline__range=(today, today + timedelta(days=3)))),
            needs_review=Count("id", filter=Q(needs_review=True)),
        ))


class ProfileView(APIView):
    def get(self, request):
        return Response(UserProfileSerializer(UserProfile.current()).data)

    def patch(self, request):
        profile = UserProfile.current()
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class NotificationListView(APIView):
    def get(self, request):
        refresh_deadline_notifications()
        qs = Notification.objects.all()
        unread_only = request.query_params.get("unread") in ("true", "1")
        if unread_only:
            qs = qs.filter(is_read=False)
        serializer = NotificationSerializer(qs[:100], many=True)
        return Response({"results": serializer.data, "unread_count": Notification.objects.filter(is_read=False).count()})


class NotificationActionView(APIView):
    action_name = None

    def post(self, request, notification_id=None, action_name=None):
        if action_name == "read-all":
            Notification.objects.filter(is_read=False).update(is_read=True)
            return Response({"updated": True})
        if notification_id is None:
            return Response({"error": "Notification id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            item = Notification.objects.get(pk=notification_id)
        except Notification.DoesNotExist:
            return Response({"error": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)
        if action_name == "read":
            item.is_read = True
            item.save(update_fields=["is_read"])
            return Response(NotificationSerializer(item).data)
        if action_name == "unread":
            item.is_read = False
            item.save(update_fields=["is_read"])
            return Response(NotificationSerializer(item).data)
        return Response({"error": "Unsupported notification action."}, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, notification_id=None):
        if notification_id is None:
            Notification.objects.filter(is_read=True).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        deleted, _ = Notification.objects.filter(pk=notification_id).delete()
        if not deleted:
            return Response({"error": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
