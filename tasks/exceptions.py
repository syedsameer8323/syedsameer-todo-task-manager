"""One consistent JSON error shape: {"error": "<message>", "fields": {...}}"""
import logging
from django.db import DatabaseError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

log = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    if isinstance(exc, DatabaseError):
        log.exception("Database error")
        return Response({"error": "The database is unavailable. Please try again shortly."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    response = exception_handler(exc, context)
    if response is None:
        log.exception("Unhandled error")
        return Response({"error": "Something went wrong on the server."},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    data = response.data
    if response.status_code == 400 and isinstance(data, dict):
        response.data = {"error": "Please fix the highlighted fields.", "fields": data}
    elif response.status_code == 404:
        response.data = {"error": "Task not found."}
    else:
        response.data = {"error": data.get("detail", "Request failed.") if isinstance(data, dict) else str(data)}
    return response
