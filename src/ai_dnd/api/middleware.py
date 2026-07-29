from __future__ import annotations

from uuid import uuid4

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:"
        )
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, *, max_bytes: int) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                too_large = int(content_length) > self.max_bytes
            except ValueError:
                too_large = True
            if too_large:
                request_id = getattr(request.state, "request_id", str(uuid4()))
                return JSONResponse(
                    status_code=413,
                    media_type="application/problem+json",
                    content={
                        "type": "about:blank",
                        "title": "Payload Too Large",
                        "status": 413,
                        "detail": "Request body exceeds the configured limit.",
                        "code": "payload_too_large",
                        "request_id": request_id,
                    },
                )
        return await call_next(request)
