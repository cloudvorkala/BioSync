"""Flask application factory; no server starts on import.

For local development from backend/: flask --app biosync.app run
Deployment must provide HTTPS as required by PROJECT_SPEC.md.
"""

from flask import Flask

from .routes import analyses


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.register_blueprint(analyses)
    return app
