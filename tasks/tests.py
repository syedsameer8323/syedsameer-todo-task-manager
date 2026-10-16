from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from .models import Task


class TaskApiTests(TestCase):
    def setUp(self):
        self.c = APIClient()
        self.today = timezone.localdate()

    def test_crud_flow(self):
        r = self.c.post("/api/tasks/", {"title": "  Write report ", "priority": "high"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["title"], "Write report")
        tid = r.data["id"]
        self.assertEqual(self.c.get(f"/api/tasks/{tid}/").status_code, 200)
        r = self.c.put(f"/api/tasks/{tid}/", {"title": "Report v2", "priority": "low", "status": "in_progress"}, format="json")
        self.assertEqual(r.data["status"], "in_progress")
        r = self.c.patch(f"/api/tasks/{tid}/", {"status": "completed"}, format="json")
        self.assertEqual(r.data["status_display"], "Completed")
        self.assertEqual(self.c.delete(f"/api/tasks/{tid}/").status_code, 204)
        self.assertEqual(self.c.get(f"/api/tasks/{tid}/").status_code, 404)

    def test_validation(self):
        r = self.c.post("/api/tasks/", {"title": "   "}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("title", r.data["fields"])
        r = self.c.post("/api/tasks/", {"title": "x", "priority": "urgent"}, format="json")
        self.assertIn("priority", r.data["fields"])
        r = self.c.post("/api/tasks/", {"title": "Overdue is allowed", "deadline": str(self.today - timedelta(days=1))}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["is_overdue"])

    def test_filter_search_overdue_stats(self):
        Task.objects.create(title="Pay rent", status="pending", deadline=self.today - timedelta(days=2))
        Task.objects.create(title="Gym", status="completed", deadline=self.today - timedelta(days=2))
        Task.objects.create(title="Pay tax", status="in_progress", deadline=self.today + timedelta(days=1))
        self.assertEqual(self.c.get("/api/tasks/?search=pay").data["count"], 2)
        self.assertEqual(self.c.get("/api/tasks/?status=completed").data["count"], 1)
        self.assertEqual(self.c.get("/api/tasks/?due=overdue").data["results"][0]["title"], "Pay rent")
        s = self.c.get("/api/tasks/stats/").data
        self.assertEqual((s["total"], s["overdue"], s["due_soon"]), (3, 1, 1))

    def test_profile_is_saved_and_validated(self):
        r = self.c.get("/api/profile/")
        self.assertEqual(r.status_code, 200)
        r = self.c.patch("/api/profile/", {"display_name": "Sameer", "email": "sameer@example.com", "phone": "1234567890"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get("/api/profile/").data["display_name"], "Sameer")
        r = self.c.patch("/api/profile/", {"display_name": "   "}, format="json")
        self.assertEqual(r.status_code, 400)
        photo = "data:image/png;base64," + ("A" * 100)
        r = self.c.patch("/api/profile/", {"photo_data": photo}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get("/api/profile/").data["photo_data"], photo)


    def test_duplicate_task_warning_can_be_overridden(self):
        payload = {"title": "Same task", "description": "Do the same thing"}
        self.assertEqual(self.c.post("/api/tasks/", payload, format="json").status_code, 201)
        duplicate = self.c.post("/api/tasks/", payload, format="json")
        self.assertEqual(duplicate.status_code, 409)
        self.assertTrue(duplicate.data["duplicate"])
        payload["allow_duplicate"] = True
        self.assertEqual(self.c.post("/api/tasks/", payload, format="json").status_code, 201)

    def test_review_filter_and_notifications(self):
        r = self.c.post("/api/tasks/", {"title": "Review this task"}, format="json")
        self.assertEqual(r.status_code, 201)
        task_id = r.data["id"]
        self.assertEqual(self.c.get("/api/notifications/").status_code, 200)
        r = self.c.patch(f"/api/tasks/{task_id}/", {"needs_review": True}, format="json")
        self.assertTrue(r.data["needs_review"])
        self.assertEqual(self.c.get("/api/tasks/?needs_review=true").data["count"], 1)
        notifications = self.c.get("/api/notifications/").data
        self.assertGreaterEqual(len(notifications["results"]), 2)
        notification_id = notifications["results"][0]["id"]
        self.assertEqual(self.c.post(f"/api/notifications/{notification_id}/read/", {}, format="json").status_code, 200)
        self.assertEqual(self.c.post("/api/notifications/read-all/", {}, format="json").status_code, 200)
