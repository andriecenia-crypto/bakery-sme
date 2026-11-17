"""Customer ordering endpoints."""
import math
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from flask import Blueprint, g, jsonify

from backend.config import (
    Config,
    bakery_now,
    bakery_tz,
    get_supabase,
    json_body,
    parse_date,
    require_auth,
)
from backend.routes.product_routes import UUID_RE, compute_availability
from backend.services import notification_service as notify

bp = Blueprint("orders", __name__, url_prefix="/api/orders")

MAX_LINES = 30
MAX_QTY = 50


def _parse_time(value):
    try:
        return datetime.strptime(str(value), "%H:%M").time()
    except (TypeError, ValueError):
        return None


@bp.post("")
@require_auth
def place_order():
    data = json_body()
    sb = get_supabase()

    # ----- validate pickup slot ------------------------------------------
    pickup_date = parse_date(data.get("pickup_date"))
    pickup_time = _parse_time(data.get("pickup_time") or "09:00")
    if not pickup_date or not pickup_time:
        return jsonify(error="Please choose a valid pickup date and time."), 400
    if not (Config.OPEN_HOUR <= pickup_time.hour < Config.CLOSE_HOUR):
        return (
            jsonify(
                error=f"Pickup times are between {Config.OPEN_HOUR:02d}:00 "
                f"and {Config.CLOSE_HOUR:02d}:00."
            ),
            400,
        )

    # ----- validate items -------------------------------------------------
    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return jsonify(error="Your basket is empty."), 400
    if len(raw_items) > MAX_LINES:
        return jsonify(error=f"An order can have at most {MAX_LINES} lines."), 400

    lines = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            return jsonify(error="Invalid item in basket."), 400
        pid = str(raw.get("product_id") or "")
        if not UUID_RE.match(pid):
            return jsonify(error="Invalid product in basket."), 400
        try:
            qty = int(raw.get("quantity"))
        except (TypeError, ValueError):
            return jsonify(error="Quantities must be whole numbers."), 400
        if qty < 1 or qty > MAX_QTY:
            return jsonify(error=f"Quantity must be between 1 and {MAX_QTY}."), 400
        notes = str(raw.get("customization_notes") or "").strip()
        if len(notes) > 300:
            return jsonify(error="Customization notes are limited to 300 characters."), 400
        lines.append({"product_id": pid, "quantity": qty, "notes": notes or None})

    # ----- load products (prices always come from the database) -----------
    ids = list({line["product_id"] for line in lines})
    products = {
        p["id"]: p
        for p in (sb.table("products").select("*").in_("id", ids).execute().data or [])
    }
    for line in lines:
        if line["product_id"] not in products:
            return jsonify(error="One of the products is no longer available."), 400

    # ----- lead time -------------------------------------------------------
    max_prep = max(products[i]["prep_time_hours"] for i in ids)
    pickup_dt = datetime.combine(pickup_date, pickup_time, tzinfo=bakery_tz())
    earliest = bakery_now() + timedelta(hours=max_prep)
    if pickup_dt < earliest:
        return (
            jsonify(
                error="Your basket needs more preparation time. The earliest pickup is "
                f"{earliest.strftime('%b %d at %I:%M %p')}."
            ),
            400,
        )

    # ----- stock check against the baking schedule -------------------------
    availability = compute_availability(sb, pickup_date.isoformat())
    wanted: dict = {}
    for line in lines:
        wanted[line["product_id"]] = wanted.get(line["product_id"], 0) + line["quantity"]
    for pid, qty in wanted.items():
        slot = availability.get(pid)
        if slot is not None and qty > slot["remaining"]:
            left = slot["remaining"]
            name = products[pid]["name"]
            msg = (
                f"Sorry, {name} is sold out for {pickup_date.isoformat()}."
                if left == 0
                else f"Only {left} × {name} left for {pickup_date.isoformat()}."
            )
            return jsonify(error=msg), 409

    # ----- create order ----------------------------------------------------
    total = Decimal("0")
    item_rows = []
    for line in lines:
        price = Decimal(str(products[line["product_id"]]["price"]))
        total += price * line["quantity"]
        item_rows.append(
            {
                "product_id": line["product_id"],
                "quantity": line["quantity"],
                "customization_notes": line["notes"],
                "unit_price": float(price),
            }
        )
    total = total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    order = (
        sb.table("orders")
        .insert(
            {
                "customer_id": g.profile["id"],
                "total_amount": float(total),
                "pickup_date": pickup_date.isoformat(),
                "pickup_time": pickup_time.strftime("%H:%M"),
            }
        )
        .execute()
        .data[0]
    )
    try:
        for row in item_rows:
            row["order_id"] = order["id"]
        sb.table("order_items").insert(item_rows).execute()
    except Exception:
        sb.table("orders").delete().eq("id", order["id"]).execute()
        raise

    # keep the customer's phone for the bakery to call about cake details
    phone = str(data.get("phone") or "").strip()[:30]
    if phone and not g.profile.get("phone"):
        sb.table("users").update({"phone": phone}).eq("id", g.profile["id"]).execute()

    notify.notify_order_placed(order, g.profile.get("full_name") or g.profile["email"])
    return jsonify(order=order), 201


@bp.get("/mine")
@require_auth
def my_orders():
    res = (
        get_supabase()
        .table("orders")
        .select("*, order_items(*, products(name, image_url))")
        .eq("customer_id", g.profile["id"])
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return jsonify(orders=res.data or [])


@bp.get("/<order_id>")
@require_auth
def get_order(order_id):
    if not UUID_RE.match(order_id):
        return jsonify(error="Invalid order id."), 400
    res = (
        get_supabase()
        .table("orders")
        .select("*, order_items(*, products(name, image_url))")
        .eq("id", order_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return jsonify(error="Order not found."), 404
    order = res.data[0]
    if order["customer_id"] != g.profile["id"] and g.profile["role"] not in ("admin", "staff"):
        return jsonify(error="Order not found."), 404
    return jsonify(order=order)


@bp.post("/<order_id>/cancel")
@require_auth
def cancel_order(order_id):
    if not UUID_RE.match(order_id):
        return jsonify(error="Invalid order id."), 400
    sb = get_supabase()
    res = (
        sb.table("orders")
        .select("*")
        .eq("id", order_id)
        .eq("customer_id", g.profile["id"])
        .limit(1)
        .execute()
    )
    if not res.data:
        return jsonify(error="Order not found."), 404
    order = res.data[0]
    if order["fulfillment_status"] != "received":
        return (
            jsonify(error="This order is already being prepared. Please call the bakery."),
            409,
        )
    updated = (
        sb.table("orders")
        .update({"fulfillment_status": "cancelled"})
        .eq("id", order_id)
        .execute()
        .data[0]
    )
    notify.notify_order_status(updated)
    notify.notify_order_cancelled_by_customer(
        updated, g.profile.get("full_name") or g.profile["email"]
    )
    return jsonify(order=updated)
