from django.db import models
from django.utils import timezone


class Task(models.Model):
    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="", max_length=2000)
    deadline = models.DateField(null=True, blank=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PENDING)
    needs_review = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status"]), models.Index(fields=["deadline"])]

    def __str__(self):
        return self.title

    @staticmethod
    def today():
        return timezone.localdate()

    @property
    def days_left(self):
        return (self.deadline - self.today()).days if self.deadline else None

    @property
    def is_overdue(self):
        d = self.days_left
        return d is not None and d < 0 and self.status != self.Status.COMPLETED

    @property
    def is_due_soon(self):
        d = self.days_left
        return d is not None and 0 <= d <= 3 and self.status != self.Status.COMPLETED


class UserProfile(models.Model):
    """Single local profile for this deliberately single-user task manager."""
    display_name = models.CharField(max_length=80, default="You")
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=30, blank=True, default="")
    photo_data = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def current(cls):
        profile, _ = cls.objects.get_or_create(pk=1, defaults={"display_name": "You"})
        return profile

    def __str__(self):
        return self.display_name


class Notification(models.Model):
    class Kind(models.TextChoices):
        TASK_CREATED = "task_created", "Task created"
        TASK_UPDATED = "task_updated", "Task updated"
        TASK_COMPLETED = "task_completed", "Task completed"
        TASK_DELETED = "task_deleted", "Task deleted"
        DUE_SOON = "due_soon", "Due soon"
        OVERDUE = "overdue", "Overdue"
        REVIEW = "review", "Review requested"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    title = models.CharField(max_length=160)
    message = models.CharField(max_length=500)
    task = models.ForeignKey(Task, null=True, blank=True, on_delete=models.SET_NULL, related_name="notifications")
    event_key = models.CharField(max_length=240, unique=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["is_read", "created_at"], name="notif_read_created_idx")]

    def __str__(self):
        return self.title
