"""Configuration, Supabase client factory and auth decorators."""
import os
from datetime import datetime, date
from functools import wraps
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from flask import g, jsonify, request
from supabase import Client, create_client

load_dotenv()


class Config:
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    BAKERY_TIMEZONE = os.getenv("BAKERY_TIMEZONE", "Asia/Manila").strip()
    OPEN_HOUR = int(os.getenv("BAKERY_OPEN_HOUR", "7"))
    CLOSE_HOUR = int(os.getenv("BAKERY_CLOSE_HOUR", "19"))
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
    PORT = int(os.getenv("PORT", "5000"))
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"


_client: Client | None = None


def get_supabase() -> Client:
    """Return a singleton Supabase client that uses the service-role key."""
    global _client
    if _client is None:
        if not Config.SUPABASE_URL or not Config.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment."
            )
        _client = create_client(Config.SUPABASE_URL, Config.SUPABASE_SERVICE_ROLE_KEY)
    return _client


# ---------------------------------------------------------------------------
# Time helpers (all bakery logic runs in the bakery's local timezone)
# ---------------------------------------------------------------------------
def bakery_tz() -> ZoneInfo:
    return ZoneInfo(Config.BAKERY_TIMEZONE)


def bakery_now() -> datetime:
    return datetime.now(bakery_tz())


def bakery_today() -> date:
    return bakery_now().date()


def parse_date(value) -> date | None:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Auth decorators
# ---------------------------------------------------------------------------
def _load_or_create_profile(sb: Client, user) -> dict:
    res = sb.table("users").select("*").eq("id", user.id).limit(1).execute()
    if res.data:
        return res.data[0]
    meta = getattr(user, "user_metadata", None) or {}
    row = {
        "id": user.id,
        "email": user.email,
        "full_name": meta.get("full_name", "") or "",
        "phone": meta.get("phone"),
        "role": "customer",
    }
    created = sb.table("users").insert(row).execute()
    return created.data[0]


def require_auth(fn):
    """Verify the Supabase JWT from the Authorization header."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            return jsonify(error="Authentication required."), 401
        token = header[7:].strip()
        sb = get_supabase()
        try:
            res = sb.auth.get_user(token)
            user = res.user if res else None
        except Exception:
            user = None
        if not user:
            return jsonify(error="Your session is invalid or has expired."), 401
        g.user = user
        g.profile = _load_or_create_profile(sb, user)
        return fn(*args, **kwargs)

    return wrapper


def require_role(*roles):
    """Require one of the given roles (e.g. 'admin', 'staff')."""

    def decorator(fn):
        @wraps(fn)
        @require_auth
        def wrapper(*args, **kwargs):
            if g.profile.get("role") not in roles:
                return jsonify(error="You do not have permission to do that."), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}
