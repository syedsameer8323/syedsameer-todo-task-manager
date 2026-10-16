# To-Do Task Manager

A responsive task manager: **Django + Django REST Framework + MySQL** backend, plain **HTML/CSS/JavaScript** frontend that talks to the REST API (no hardcoded data).

## Features
- Create, view, edit, delete tasks (title, description, deadline, priority, status)
- Statuses: Pending, In Progress, Completed. Priorities: Low, Medium, High
- Filter by status (tabs), priority and deadline; search by title; sort; pagination
- Overdue tasks highlighted in red; "due today / tomorrow / in N days" labels; dashboard counters
- One-click "mark completed", delete confirmation, toasts, inline field errors
- Validation on client and server; consistent JSON errors; 404 / 400 / 503 / 500 handled
- Responsive: desktop sidebar, tablet grid, mobile slide-in menu with the table turning into cards

## Project layout
```
manage.py
taskmanager/   settings, urls, wsgi
tasks/         models, serializers, views (ViewSet), exceptions, urls, tests, migrations
templates/index.html
static/css/style.css, static/js/app.js
docs/schema.sql                       MySQL database + user setup
docs/postman_collection.json          Postman requests with test scripts
```

## 1. Prerequisites
Python 3.10+, MySQL 8 (or MariaDB 10.6+). For `mysqlclient` you may need build tools:
- Ubuntu/Debian: `sudo apt install python3-dev default-libmysqlclient-dev build-essential pkg-config`
- macOS: `brew install mysql pkg-config`
- Windows: `pip install mysqlclient` normally installs a prebuilt wheel.

## 2. Install
```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 3. Create the MySQL database
```bash
mysql -u root -p < docs/schema.sql
```
This creates database `taskmanager` and user `taskuser` / `taskpass`. To use other credentials, edit the SQL and
set environment variables before running Django (see `.env.example`):
`DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT`.
```bash
export DB_PASSWORD=your-password       # Windows PowerShell: $env:DB_PASSWORD="your-password"
```

## 4. Migrate and run
```bash
python manage.py migrate
python manage.py runserver
```
Open http://127.0.0.1:8000/ . Tasks are stored in MySQL, so they persist after you stop and restart the server.

No MySQL handy? Try it with SQLite: `DB_ENGINE=sqlite python manage.py migrate && DB_ENGINE=sqlite python manage.py runserver`.

## 5. Run automated tests
```bash
python manage.py test        # uses a temporary test database (needs CREATE privilege; or DB_ENGINE=sqlite)
```
If MySQL denies creating `test_taskmanager`, run: `GRANT ALL ON test_taskmanager.* TO 'taskuser'@'localhost';`

## REST API
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tasks/` | List (query: `status`, `priority`, `search`, `due=overdue\|soon`, `ordering=newest\|oldest\|deadline\|priority\|title`, `page`, `page_size`) |
| POST | `/api/tasks/` | Create |
| GET | `/api/tasks/{id}/` | Retrieve |
| PUT | `/api/tasks/{id}/` | Full update |
| PATCH | `/api/tasks/{id}/` | Partial update |
| DELETE | `/api/tasks/{id}/` | Delete (204) |
| GET | `/api/tasks/stats/` | Counters: total, pending, in_progress, completed, overdue, due_soon |

Task body: `{"title": "Write report", "description": "", "deadline": "2026-12-31", "priority": "high", "status": "pending"}`

Errors always look like `{"error": "message", "fields": {"title": ["Task title is required."]}}`
(400 validation, 404 not found, 503 database unavailable, 500 unexpected).

## Testing with Postman
1. Postman > Import > `docs/postman_collection.json`.
2. The `baseUrl` collection variable is `http://127.0.0.1:8000`.
3. Run the folder in order (Collection Runner): Create saves `taskId`, then Get, Put, Patch, List, Stats, Delete and the 404 check run against it. Each request has test scripts.

## Notes
- Deadlines in the past are rejected for new or changed deadlines; existing tasks naturally become overdue.
- Timezone defaults to `Asia/Kolkata` (`TIME_ZONE` env var to change) and drives "overdue" calculations.
- For production: set `DJANGO_DEBUG=False`, a real `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and serve static files via a web server/WhiteNoise.
