
"""Application entry point for the Critical Chain Planning API."""

import json
import logging
import time

from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
import models  # noqa: F401 - registers SQLAlchemy model metadata
from routes import router


# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOG_DIR / "api_requests.log"


class JSONFormatter(logging.Formatter):
    """Format each log event as a single JSON line for log ingestion."""

    def format(self, record):
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for field in (
            "method",
            "path",
            "status_code",
            "duration_ms",
        ):
            if hasattr(record, field):
                entry[field] = getattr(record, field)

        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(entry)


file_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
file_handler.setFormatter(JSONFormatter())

logger = logging.getLogger("planner.api")
logger.setLevel(logging.INFO)
logger.handlers.clear()
logger.addHandler(file_handler)
logger.propagate = False


# ---------------------------------------------------------------------------
# Database initialization
# ---------------------------------------------------------------------------

Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Critical Chain Planning API",
    description="Scheduling and project persistence for Critical Chain Planning.",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# CORS configuration
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=[
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "OPTIONS",
    ],
    allow_headers=[
        "Content-Type",
    ],
)


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"

    return response


# ---------------------------------------------------------------------------
# API request logging middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def log_api_requests(request: Request, call_next):
    start_time = time.perf_counter()

    method = request.method
    path = request.url.path

    try:
        response = await call_next(request)

        duration_ms = round(
            (time.perf_counter() - start_time) * 1000, 2
        )

        logger.info(
            "API request completed",
            extra={
                "method": method,
                "path": path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )

        return response

    except Exception:
        duration_ms = round(
            (time.perf_counter() - start_time) * 1000, 2
        )

        logger.exception(
            "Unhandled API exception",
            extra={
                "method": method,
                "path": path,
                "duration_ms": duration_ms,
            },
        )

        raise


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

app.include_router(router)


@app.get("/", tags=["Health"])
def health_check() -> dict[str, str]:
    """Confirm that the API is running."""
    return {
        "status": "ok",
        "message": "Critical Chain Planning API is running.",
    }
