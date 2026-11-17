"""Flask application factory for Crust & Crumb Bakery."""
import logging
import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from backend.config import Config
from backend.routes.admin_routes import bp as admin_bp
from backend.routes.auth_routes import bp as auth_bp
from backend.routes.order_routes import bp as order_bp
from backend.routes.product_routes import bp as product_bp

FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), os.pardir, "frontend")
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("crust_and_crumb")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGINS.split(",")}})

    for blueprint in (auth_bp, product_bp, order_bp, admin_bp):
        app.register_blueprint(blueprint)

    # ---- public runtime config for the browser (anon key is safe to expose) ----
    @app.get("/api/config")
    def public_config():
        if not Config.SUPABASE_URL or not Config.SUPABASE_ANON_KEY:
            return jsonify(error="Server is missing SUPABASE_URL / SUPABASE_ANON_KEY."), 500
        return jsonify(
            supabaseUrl=Config.SUPABASE_URL,
            supabaseAnonKey=Config.SUPABASE_ANON_KEY,
            openHour=Config.OPEN_HOUR,
            closeHour=Config.CLOSE_HOUR,
            timezone=Config.BAKERY_TIMEZONE,
        )

    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    # ---- serve the static frontend ----
    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    # ---- JSON error handling for the API ----
    @app.errorhandler(Exception)
    def handle_error(exc):
        if isinstance(exc, HTTPException):
            if request.path.startswith("/api/"):
                return jsonify(error=exc.description), exc.code
            return exc
        log.exception("Unhandled error on %s %s", request.method, request.path)
        return jsonify(error="Something went wrong on our side. Please try again."), 500

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=Config.PORT, debug=Config.DEBUG)
