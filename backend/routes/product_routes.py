"""Public catalog + staff product CRUD + availability calculation."""
import re

from flask import Blueprint, jsonify, request

from backend.config import (
    bakery_today,
    get_supabase,
    json_body,
    parse_date,
    require_role,
)

bp = Blueprint("products", __name__, url_prefix="/api/products")

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


# ---------------------------------------------------------------------------
# Shared helpers (also imported by order_routes and admin_routes)
# ---------------------------------------------------------------------------
def fetch_demand(sb, start: str, end: str) -> dict:
    """Total quantity ordered per product for pickups in [start, end] (non-cancelled)."""
    res = (
        sb.table("order_items")
        .select("product_id, quantity, orders!inner(pickup_date, fulfillment_status)")
        .gte("orders.pickup_date", start)
        .lte("orders.pickup_date", end)
        .neq("orders.fulfillment_status", "cancelled")
        .execute()
    )
    demand: dict = {}
    for row in res.data or []:
        demand[row["product_id"]] = demand.get(row["product_id"], 0) + row["quantity"]
    return demand


def compute_availability(sb, day: str) -> dict:
    """For products with a baking batch on `day`: capacity, ordered and remaining."""
    batches = (
        sb.table("baking_batches")
        .select("product_id, target_quantity")
        .eq("batch_date", day)
        .execute()
    )
    capacity: dict = {}
    for b in batches.data or []:
        capacity[b["product_id"]] = capacity.get(b["product_id"], 0) + b["target_quantity"]
    if not capacity:
        return {}
    demand = fetch_demand(sb, day, day)
    return {
        pid: {
            "capacity": cap,
            "ordered": demand.get(pid, 0),
            "remaining": max(cap - demand.get(pid, 0), 0),
        }
        for pid, cap in capacity.items()
    }


def validate_product(data: dict, partial: bool = False):
    """Return (clean_dict, error_message)."""
    clean: dict = {}

    if not partial or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name or len(name) > 120:
            return None, "Product name is required (max 120 characters)."
        clean["name"] = name

    if "description" in data:
        desc = str(data.get("description") or "").strip()
        if len(desc) > 600:
            return None, "Description is too long (max 600 characters)."
        clean["description"] = desc or None

    if not partial or "price" in data:
        try:
            price = round(float(data.get("price")), 2)
        except (TypeError, ValueError):
            return None, "Price must be a number."
        if price < 0 or price > 1_000_000:
            return None, "Price must be between 0 and 1,000,000."
        clean["price"] = price

    if "prep_time_hours" in data or not partial:
        try:
            prep = int(data.get("prep_time_hours", 0) or 0)
        except (TypeError, ValueError):
            return None, "Prep time must be a whole number of hours."
        if prep < 0 or prep > 720:
            return None, "Prep time must be between 0 and 720 hours."
        clean["prep_time_hours"] = prep

    if "category_id" in data:
        cid = data.get("category_id") or None
        if cid is not None and not UUID_RE.match(str(cid)):
            return None, "Invalid category."
        clean["category_id"] = cid

    if "image_url" in data:
        url = str(data.get("image_url") or "").strip()
        if url and not re.match(r"^https?://", url, re.I):
            return None, "Image URL must start with http:// or https://"
        if len(url) > 1000:
            return None, "Image URL is too long."
        clean["image_url"] = url or None

    if "is_featured" in data:
        clean["is_featured"] = bool(data.get("is_featured"))

    return clean, None


def _is_fk_violation(exc: Exception) -> bool:
    return "23503" in str(exc) or "foreign key" in str(exc).lower()


def _is_unique_violation(exc: Exception) -> bool:
    return "23505" in str(exc) or "duplicate key" in str(exc).lower()


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------
@bp.get("")
def list_products():
    sb = get_supabase()
    query = sb.table("products").select("*, categories(name, slug)").order("name")
    category = request.args.get("category")
    if category and UUID_RE.match(category):
        query = query.eq("category_id", category)
    return jsonify(products=query.execute().data or [])


@bp.get("/categories")
def list_categories():
    res = get_supabase().table("categories").select("*").order("name").execute()
    return jsonify(categories=res.data or [])


@bp.get("/availability")
def availability():
    day = request.args.get("date") or bakery_today().isoformat()
    if not parse_date(day):
        return jsonify(error="Date must be formatted YYYY-MM-DD."), 400
    return jsonify(date=day, availability=compute_availability(get_supabase(), day))


# ---------------------------------------------------------------------------
# Staff CRUD
# ---------------------------------------------------------------------------
@bp.post("")
@require_role("admin", "staff")
def create_product():
    clean, error = validate_product(json_body())
    if error:
        return jsonify(error=error), 400
    try:
        res = get_supabase().table("products").insert(clean).execute()
    except Exception as exc:
        if _is_unique_violation(exc):
            return jsonify(error="A product with that name already exists."), 409
        raise
    return jsonify(product=res.data[0]), 201


@bp.put("/<product_id>")
@require_role("admin", "staff")
def update_product(product_id):
    if not UUID_RE.match(product_id):
        return jsonify(error="Invalid product id."), 400
    clean, error = validate_product(json_body(), partial=True)
    if error:
        return jsonify(error=error), 400
    if not clean:
        return jsonify(error="Nothing to update."), 400
    try:
        res = get_supabase().table("products").update(clean).eq("id", product_id).execute()
    except Exception as exc:
        if _is_unique_violation(exc):
            return jsonify(error="A product with that name already exists."), 409
        raise
    if not res.data:
        return jsonify(error="Product not found."), 404
    return jsonify(product=res.data[0])


@bp.delete("/<product_id>")
@require_role("admin", "staff")
def delete_product(product_id):
    if not UUID_RE.match(product_id):
        return jsonify(error="Invalid product id."), 400
    try:
        res = get_supabase().table("products").delete().eq("id", product_id).execute()
    except Exception as exc:
        if _is_fk_violation(exc):
            return (
                jsonify(
                    error="This product appears on past orders and can't be deleted. "
                    "Edit it instead."
                ),
                409,
            )
        raise
    if not res.data:
        return jsonify(error="Product not found."), 404
    return jsonify(ok=True)
