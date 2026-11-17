"""Creates in-app notifications stored in `bakery_notifications`."""
import logging

from backend.config import get_supabase

log = logging.getLogger(__name__)

STATUS_MESSAGES = {
    "received": "We've received your order and will start preparing it soon.",
    "baking": "Good news! Your order is now in the oven.",
    "ready_for_pickup": "Your order is fresh and ready for pickup!",
    "completed": "Your order has been picked up. Thank you for choosing Crust & Crumb!",
    "cancelled": "Your order has been cancelled.",
}


def notify_user(user_id: str, message: str) -> None:
    """Insert one notification. Failures are logged, never raised."""
    try:
        get_supabase().table("bakery_notifications").insert(
            {"user_id": user_id, "message": message}
        ).execute()
    except Exception:  # pragma: no cover - notifications must not break orders
        log.exception("Could not create notification for %s", user_id)


def notify_staff(message: str) -> None:
    """Notify every admin and staff member."""
    try:
        sb = get_supabase()
        staff = sb.table("users").select("id").in_("role", ["admin", "staff"]).execute()
        rows = [{"user_id": s["id"], "message": message} for s in staff.data or []]
        if rows:
            sb.table("bakery_notifications").insert(rows).execute()
    except Exception:  # pragma: no cover
        log.exception("Could not notify staff")


def short_id(order_id: str) -> str:
    return str(order_id)[:8].upper()


def notify_order_placed(order: dict, customer_name: str) -> None:
    ref = short_id(order["id"])
    notify_user(
        order["customer_id"],
        f"Order #{ref} placed for pickup on {order['pickup_date']}. {STATUS_MESSAGES['received']}",
    )
    notify_staff(
        f"New order #{ref} from {customer_name or 'a customer'} "
        f"for pickup on {order['pickup_date']} (₱{float(order['total_amount']):,.2f})."
    )


def notify_order_status(order: dict) -> None:
    ref = short_id(order["id"])
    status = order["fulfillment_status"]
    notify_user(
        order["customer_id"],
        f"Order #{ref}: {STATUS_MESSAGES.get(status, 'Status updated to ' + status + '.')}",
    )


def notify_order_cancelled_by_customer(order: dict, customer_name: str) -> None:
    ref = short_id(order["id"])
    notify_staff(f"{customer_name or 'A customer'} cancelled order #{ref}.")
