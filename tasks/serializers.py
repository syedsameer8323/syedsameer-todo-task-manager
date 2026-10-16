from rest_framework import serializers
from .models import Notification, Task, UserProfile


class TaskSerializer(serializers.ModelSerializer):
    is_overdue = serializers.BooleanField(read_only=True)
    is_due_soon = serializers.BooleanField(read_only=True)
    days_left = serializers.IntegerField(read_only=True)
    priority_display = serializers.CharField(source="get_priority_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Task
        fields = ["id", "title", "description", "deadline", "priority", "priority_display",
                  "status", "status_display", "needs_review", "is_overdue", "is_due_soon", "days_left",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"title": {"error_messages": {
            "required": "Task title is required.", "blank": "Task title cannot be empty.",
            "null": "Task title cannot be empty.", "max_length": "Title must be 200 characters or fewer."}}}

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Task title cannot be empty.")
        return value

    def validate_description(self, value):
        if len(value) > 2000:
            raise serializers.ValidationError("Description must be 2000 characters or fewer.")
        return value

    def validate_deadline(self, value):
        # Past deadlines are valid: unfinished tasks may already be overdue.
        return value


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ["display_name", "email", "phone", "photo_data", "updated_at"]
        read_only_fields = ["updated_at"]

    def validate_display_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Name cannot be empty.")
        return value

    def validate_photo_data(self, value):
        if not value:
            return ""
        import re
        if not re.match(r"^data:image/(png|jpeg|webp);base64,", value):
            raise serializers.ValidationError("Choose a PNG, JPG, or WEBP image.")
        if len(value) > 2_800_000:
            raise serializers.ValidationError("Profile photos must be 2 MB or smaller.")
        return value


class NotificationSerializer(serializers.ModelSerializer):
    task_title = serializers.SerializerMethodField()
    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "message", "task", "task_title", "is_read", "created_at"]
        read_only_fields = fields

    def get_task_title(self, obj):
        return obj.task.title if obj.task_id else ""
