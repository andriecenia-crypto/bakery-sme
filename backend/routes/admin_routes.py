"""Admin / staff endpoints: orders, baking schedule, forecasting, team."""
import math
from datetime import timedelta

from flask import Blueprint, g, jsonify, request

from backend.config import (
    bakery_today,
    get_supabase,
    json_body,
    parse_date,
    require_role,
)
from backend.routes.product_routes import UUID_RE, fetch_demand
from backend.services import notification_service as notify

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

ORDER_STATUSES = ("received", "baking", "ready_for_pickup", "completed", "cancelled")
PAYMENT_STATUSES = ("unpaid", "paid")
BATCH_STATUSES = ("scheduled", "baking", "completed")
ROLES = ("admin", "staff", "customer")
FORECAST_LOOKBACK_DAYS = 14
FORECAST_BUFFER = 1.15


def _is_unique_violation(exc: Exception) -> bool:
    return "23505" in str(exc) or "duplicate key" in str(exc).lower()


# ---------------------------------------------------------------------------
# Dashboard statistics
# ---------------------------------------------------------------------------
@bp.get("/stats")
@require_role("admin", "staff")
def stats():
    sb = get_supabase()
    today = bakery_today().isoformat()

    todays = (
        sb.table("orders")
        .select("total_amount, payment_status, fulfillment_status")
        .eq("pickup_date", today)
        .neq("fulfillment_status", "cancelled")
        .execute()
        .data
        or []
    )
    open_orders = (
        sb.table("orders")
        .select("id", count="exact")
        .in_("fulfillment_status", ["received", "baking"])
        .execute()
    )
    ready = (
        sb.table("orders")
        .select("id", count="exact")
        .eq("fulfillment_status", "ready_for_pickup")
        .execute()
    )
    batches = (
        sb.table("baking_batches")
        .select("id", count="exact")
        .eq("batch_date", today)
        .execute()
    )
    products = sb.table("products").select("id", count="exact").execute()

    return jsonify(
        today=today,
        orders_today=len(todays),
        revenue_today=round(
            sum(float(o["total_amount"]) for o in todays if o["payment_status"] == "paid"), 2
        ),
        unpaid_today=round(
            sum(float(o["total_amount"]) for o in todays if o["payment_status"] == "unpaid"), 2
        ),
        open_orders=open_orders.count or 0,
        ready_for_pickup=ready.count or 0,
        batches_today=batches.count or 0,
        products=products.count or 0,
    )


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------
@bp.get("/orders")
@require_role("admin", "staff")
def list_orders():
    query = (
        get_supabase()
        .table("orders")
        .select("*, users(full_name, email, phone), order_items(*, products(name))")
        .order("pickup_date")
        .order("pickup_time")
        .limit(200)
    )
    status = request.args.get("status")
    if status in ORDER_STATUSES:
        query = query.eq("fulfillment_status", status)
    elif status == "open":
        query = query.in_("fulfillment_status", ["received", "baking", "ready_for_pickup"])
    day = request.args.get("date")
    if day:
        if not parse_date(day):
            return jsonify(error="Date must be formatted YYYY-MM-DD."), 400
        query = query.eq("pickup_date", day)
    return jsonify(orders=query.execute().data or [])


@bp.patch("/orders/<order_id>")
@require_role("admin", "staff")
def update_order(order_id):
    if not UUID_RE.match(order_id):
        return jsonify(error="Invalid order id."), 400
    data = json_body()
    update = {}
    if "fulfillment_status" in data:
        if data["fulfillment_status"] not in ORDER_STATUSES:
            return jsonify(error="Invalid fulfillment status."), 400
        update["fulfillment_status"] = data["fulfillment_status"]
    if "payment_status" in data:
        if data["payment_status"] not in PAYMENT_STATUSES:
            return jsonify(error="Invalid payment status."), 400
        update["payment_status"] = data["payment_status"]
    if not update:
        return jsonify(error="Nothing to update."), 400

    sb = get_supabase()
    existing = sb.table("orders").select("*").eq("id", order_id).limit(1).execute().data
    if not existing:
        return jsonify(error="Order not found."), 404

    updated = sb.table("orders").update(update).eq("id", order_id).execute().data[0]
    if (
        "fulfillment_status" in update
        and update["fulfillment_status"] != existing[0]["fulfillment_status"]
    ):
        notify.notify_order_status(updated)
    return jsonify(order=updated)


# ---------------------------------------------------------------------------
# Baking schedule (batches)
# ---------------------------------------------------------------------------
def _validate_batch(data: dict, partial: bool = False):
    clean = {}
    if not partial or "product_id" in data:
        pid = str(data.get("product_id") or "")
        if not UUID_RE.match(pid):
            return None, "Please choose a product."
        clean["product_id"] = pid
    if not partial or "batch_date" in data:
        day = parse_date(data.get("batch_date"))
        if not day:
            return None, "Please choose a valid batch date."
        clean["batch_date"] = day.isoformat()
    if not partial or "target_quantity" in data:
        try:
            qty = int(data.get("target_quantity"))
        except (TypeError, ValueError):
            return None, "Target quantity must be a whole number."
        if qty < 1 or qty > 10000:
            return None, "Target quantity must be between 1 and 10,000."
        clean["target_quantity"] = qty
    if "actual_baked" in data:
        try:
            actual = int(data.get("actual_baked") or 0)
        except (TypeError, ValueError):
            return None, "Actual baked must be a whole number."
        if actual < 0 or actual > 10000:
            return None, "Actual baked must be between 0 and 10,000."
        clean["actual_baked"] = actual
    if "status" in data:
        if data["status"] not in BATCH_STATUSES:
            return None, "Invalid batch status."
        clean["status"] = data["status"]
    return clean, None


@bp.get("/batches")
@require_role("admin", "staff")
def list_batches():
    day = request.args.get("date") or bakery_today().isoformat()
    if not parse_date(day):
        return jsonify(error="Date must be formatted YYYY-MM-DD."), 400
    res = (
        get_supabase()
        .table("baking_batches")
        .select("*, products(name, image_url)")
        .eq("batch_date", day)
        .order("created_at")
        .execute()
    )
    return jsonify(date=day, batches=res.data or [])


@bp.post("/batches")
@require_role("admin", "staff")
def create_batch():
    clean, error = _validate_batch(json_body())
    if error:
        return jsonify(error=error), 400
    try:
        res = get_supabase().table("baking_batches").insert(clean).execute()
    except Exception as exc:
        if _is_unique_violation(exc):
            return jsonify(error="That product already has a batch on that date."), 409
        raise
    return jsonify(batch=res.data[0]), 201


@bp.put("/batches/<batch_id>")
@require_role("admin", "staff")
def update_batch(batch_id):
    if not UUID_RE.match(batch_id):
        return jsonify(error="Invalid batch id."), 400
    clean, error = _validate_batch(json_body(), partial=True)
    if error:
        return jsonify(error=error), 400
    if not clean:
        return jsonify(error="Nothing to update."), 400
    try:
        res = get_supabase().table("baking_batches").update(clean).eq("id", batch_id).execute()
    except Exception as exc:
        if _is_unique_violation(exc):
            return jsonify(error="That product already has a batch on that date."), 409
        raise
    if not res.data:
        return jsonify(error="Batch not found."), 404
    return jsonify(batch=res.data[0])


@bp.delete("/batches/<batch_id>")
@require_role("admin", "staff")
def delete_batch(batch_id):
    if not UUID_RE.match(batch_id):
        return jsonify(error="Invalid batch id."), 400
    res = get_supabase().table("baking_batches").delete().eq("id", batch_id).execute()
    if not res.data:
        return jsonify(error="Batch not found."), 404
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Daily batch forecasting
# ---------------------------------------------------------------------------
def build_forecast(sb, day) -> list:
    """Per product: ordered qty, trailing average demand, scheduled batch, suggestion."""
    start = (day - timedelta(days=FORECAST_LOOKBACK_DAYS)).isoformat()
    end = (day - timedelta(days=1)).isoformat()
    history = fetch_demand(sb, start, end)
    ordered = fetch_demand(sb, day.isoformat(), day.isoformat())

    batches = (
        sb.table("baking_batches")
        .select("product_id, target_quantity")
        .eq("batch_date", day.isoformat())
        .execute()
        .data
        or []
    )
    scheduled = {b["product_id"]: b["target_quantity"] for b in batches}
    products = (
        sb.table("products")
        .select("id, name, prep_time_hours, image_url, categories(name)")
        .order("name")
        .execute()
        .data
        or []
    )

    rows = []
    for p in products:
        pid = p["id"]
        avg = history.get(pid, 0) / FORECAST_LOOKBACK_DAYS
        ord_qty = ordered.get(pid, 0)
        made_to_order = p["prep_time_hours"] >= 24
        if made_to_order:
            suggested = ord_qty
        else:
            suggested = max(ord_qty, math.ceil(avg * FORECAST_BUFFER)) if avg or ord_qty else 0
        sched = scheduled.get(pid, 0)
        rows.append(
            {
                "product_id": pid,
                "name": p["name"],
                "category": (p.get("categories") or {}).get("name"),
                "made_to_order": made_to_order,
                "ordered": ord_qty,
                "avg_daily": round(avg, 1),
                "scheduled": sched,
                "suggested": suggested,
                "gap": suggested - sched,
            }
        )
    rows.sort(key=lambda r: (-r["suggested"], r["name"]))
    return rows


@bp.get("/forecast")
@require_role("admin", "staff")
def forecast():
    day = parse_date(request.args.get("date")) or bakery_today()
    return jsonify(
        date=day.isoformat(),
        lookback_days=FORECAST_LOOKBACK_DAYS,
        buffer=FORECAST_BUFFER,
        forecast=build_forecast(get_supabase(), day),
    )


@bp.post("/batches/generate")
@require_role("admin", "staff")
def generate_batches():
    """Create 'scheduled' batches from the forecast for products with no batch yet."""
    day = parse_date(json_body().get("date")) or bakery_today()
    sb = get_supabase()
    rows = [
        {
            "product_id": r["product_id"],
            "batch_date": day.isoformat(),
            "target_quantity": r["suggested"],
            "status": "scheduled",
        }
        for r in build_forecast(sb, day)
        if r["suggested"] > 0 and r["scheduled"] == 0
    ]
    if rows:
        sb.table("baking_batches").insert(rows).execute()
    return jsonify(created=len(rows), date=day.isoformat())


# ---------------------------------------------------------------------------
# Team management (admin only)
# ---------------------------------------------------------------------------
@bp.get("/users")
@require_role("admin")
def list_users():
    res = (
        get_supabase()
        .table("users")
        .select("id, email, full_name, role, phone, created_at")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )
    return jsonify(users=res.data or [])


@bp.patch("/users/<user_id>/role")
@require_role("admin")
def set_user_role(user_id):
    if not UUID_RE.match(user_id):
        return jsonify(error="Invalid user id."), 400
    role = json_body().get("role")
    if role not in ROLES:
        return jsonify(error="Invalid role."), 400
    if user_id == g.profile["id"] and role != "admin":
        return jsonify(error="You can't remove your own admin access."), 400
    res = get_supabase().table("users").update({"role": role}).eq("id", user_id).execute()
    if not res.data:
        return jsonify(error="User not found."), 404
    return jsonify(user=res.data[0])
