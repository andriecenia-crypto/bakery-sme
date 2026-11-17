"""Profile and notification endpoints for the signed-in user."""
from flask import Blueprint, g, jsonify

from backend.config import get_supabase, json_body, require_auth

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.get("/me")
@require_auth
def me():
    return jsonify(profile=g.profile)


@bp.put("/me")
@require_auth
def update_me():
    data = json_body()
    update = {}
    if "full_name" in data:
        name = str(data["full_name"] or "").strip()
        if not name or len(name) > 120:
            return jsonify(error="Please enter your name (max 120 characters)."), 400
        update["full_name"] = name
    if "phone" in data:
        phone = str(data["phone"] or "").strip()
        if len(phone) > 30:
            return jsonify(error="Phone number is too long."), 400
        update["phone"] = phone or None
    if not update:
        return jsonify(error="Nothing to update."), 400
    res = get_supabase().table("users").update(update).eq("id", g.profile["id"]).execute()
    return jsonify(profile=res.data[0])


@bp.get("/notifications")
@require_auth
def list_notifications():
    res = (
        get_supabase()
        .table("bakery_notifications")
        .select("*")
        .eq("user_id", g.profile["id"])
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    items = res.data or []
    return jsonify(
        notifications=items, unread=sum(1 for n in items if not n["is_read"])
    )


@bp.post("/notifications/read")
@require_auth
def mark_notifications_read():
    (
        get_supabase()
        .table("bakery_notifications")
        .update({"is_read": True})
        .eq("user_id", g.profile["id"])
        .eq("is_read", False)
        .execute()
    )
    return jsonify(ok=True)
