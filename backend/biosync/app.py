"""Flask application factory; no server starts on import.

For local development from backend/: flask --app biosync.app run
Deployment must provide HTTPS as required by PROJECT_SPEC.md.
"""

from flask import Flask

from .routes import analyses


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.register_blueprint(analyses)

    @app.get("/health")
    def health():
        # Liveness only: no provider call, credentials check, or calculation.
        return {"status": "ok"}

    @app.after_request
    def log_failure(response):
        if response.status_code >= 400:
            body = response.get_json(silent=True) or {}
            code = body.get("error", {}).get("code", "HTTP_ERROR")
            # No bodies, paths, record IDs, credentials or provider messages.
            app.logger.warning("backend_request_failed status=%s code=%s", response.status_code, code)
        return response

    return app
