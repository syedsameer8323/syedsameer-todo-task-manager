from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0002_userprofile_task_needs_review_notification"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="photo_data",
            field=models.TextField(blank=True, default=""),
        ),
    ]