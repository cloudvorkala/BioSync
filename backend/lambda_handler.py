"""API Gateway proxy entry point; the same Flask factory serves local and AWS."""

import serverless_wsgi

from biosync.app import create_app


app = create_app()


def handler(event, context):
    return serverless_wsgi.handle_request(app, event, context)
