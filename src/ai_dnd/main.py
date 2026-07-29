from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ai_dnd import __version__
from ai_dnd.api.middleware import (
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from ai_dnd.api.routes import assets, auth, campaigns, health, jobs, legacy, realtime, voice
from ai_dnd.application.demo import seed_demo_if_empty
from ai_dnd.application.jobs import BackgroundJobManager
from ai_dnd.application.realtime import RealtimeBroker
from ai_dnd.core.logging import configure_logging
from ai_dnd.core.settings import Settings, get_settings
from ai_dnd.domain.errors import ConflictError, NotFoundError, ValidationError
from ai_dnd.infrastructure.database import create_engine, create_session_factory
from ai_dnd.infrastructure.security import SecurityManager
from ai_dnd.integrations.llm import create_llm_provider
from ai_dnd.integrations.voice import create_stt_provider
from ai_dnd.migrations import run_migrations


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


def _problem(
    request: Request,
    *,
    status_code: int,
    title: str,
    detail: str,
    code: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    body: dict[str, object] = {
        "type": "about:blank",
        "title": title,
        "status": status_code,
        "detail": detail,
        "code": code,
        "request_id": _request_id(request),
    }
    if field_errors:
        body["field_errors"] = field_errors
    return JSONResponse(
        status_code=status_code,
        content=body,
        media_type="application/problem+json",
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    application_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        application_settings.ensure_directories()
        configure_logging(application_settings.log_level)
        engine = create_engine(application_settings)
        session_factory = create_session_factory(engine)
        await asyncio.to_thread(run_migrations, application_settings)
        async with session_factory() as session:
            await seed_demo_if_empty(session)
        app.state.settings = application_settings
        app.state.engine = engine
        app.state.session_factory = session_factory
        app.state.security = SecurityManager(application_settings.data_dir)
        app.state.realtime = RealtimeBroker(session_factory)
        app.state.jobs = BackgroundJobManager(
            session_factory,
            concurrency=application_settings.job_concurrency,
        )
        app.state.llm = create_llm_provider(application_settings)
        app.state.stt = create_stt_provider(application_settings)
        structlog.get_logger().info(
            "application_started",
            version=__version__,
            lan_mode=application_settings.lan_mode,
        )
        try:
            yield
        finally:
            await app.state.jobs.shutdown()
            await engine.dispose()
            structlog.get_logger().info("application_stopped")

    app = FastAPI(
        title="AI-DND API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        BodySizeLimitMiddleware,
        max_bytes=application_settings.max_upload_bytes,
    )
    app.add_middleware(RequestContextMiddleware)
    if application_settings.environment == "development":
        app.add_middleware(
            CORSMiddleware,
            allow_origins=application_settings.allowed_dev_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "Idempotency-Key", "X-Request-ID"],
        )

    prefix = "/api/v1"
    app.include_router(health.router, prefix=prefix)
    app.include_router(auth.router, prefix=prefix)
    app.include_router(campaigns.router, prefix=prefix)
    app.include_router(jobs.router, prefix=prefix)
    app.include_router(realtime.router, prefix=prefix)
    app.include_router(assets.router, prefix=prefix)
    app.include_router(legacy.router, prefix=prefix)
    app.include_router(voice.router, prefix=prefix)

    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, error: NotFoundError) -> JSONResponse:
        return _problem(
            request,
            status_code=404,
            title="Not Found",
            detail=str(error),
            code=error.code,
        )

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, error: ConflictError) -> JSONResponse:
        return _problem(
            request,
            status_code=409,
            title="Conflict",
            detail=str(error),
            code=error.code,
        )

    @app.exception_handler(ValidationError)
    async def domain_validation_handler(request: Request, error: ValidationError) -> JSONResponse:
        return _problem(
            request,
            status_code=422,
            title="Validation Error",
            detail=str(error),
            code=error.code,
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        fields: dict[str, list[str]] = {}
        for item in error.errors():
            path = ".".join(map(str, item["loc"]))
            fields.setdefault(path, []).append(str(item["msg"]))
        return _problem(
            request,
            status_code=422,
            title="Validation Error",
            detail="Request data did not pass validation.",
            code="request_validation_error",
            field_errors=fields,
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, error: HTTPException) -> JSONResponse:
        detail = error.detail if isinstance(error.detail, str) else "Request failed."
        return _problem(
            request,
            status_code=error.status_code,
            title="HTTP Error",
            detail=detail,
            code=f"http_{error.status_code}",
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, error: Exception) -> JSONResponse:
        structlog.get_logger().exception(
            "unhandled_request_error",
            path=request.url.path,
            error_type=error.__class__.__name__,
        )
        return _problem(
            request,
            status_code=500,
            title="Internal Server Error",
            detail="An unexpected error occurred.",
            code="internal_error",
        )

    demo_assets = application_settings.demo_assets_dir
    if demo_assets.is_dir():
        app.mount("/demo-assets", StaticFiles(directory=demo_assets), name="demo-assets")

    dist_dir = application_settings.web_dist_dir
    if dist_dir.is_dir():
        app.mount("/app-assets", StaticFiles(directory=dist_dir), name="web-assets")

        @app.get("/{route:path}", include_in_schema=False)
        async def spa(route: str) -> FileResponse:
            del route
            return FileResponse(dist_dir / "index.html")
    else:

        @app.get("/", include_in_schema=False)
        async def root() -> dict[str, str]:
            return {
                "name": "AI-DND",
                "version": __version__,
                "api_docs": "/api/docs",
                "frontend": "Run the Vite development server or build web/dist.",
            }

    return app


app = create_app()
