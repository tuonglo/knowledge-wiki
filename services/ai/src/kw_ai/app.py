"""FastAPI entrypoint. Phase 0: health only. Retrieval/chat and the indexer arrive in Phases 4-5."""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis

from kw_ai.settings import settings

HealthCheck = Callable[[], Awaitable[object]]


def create_app(checks: dict[str, HealthCheck] | None = None) -> FastAPI:
    """Build the app. Tests pass `checks`; in production they're wired to real Postgres/Redis."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if checks is not None:
            app.state.checks = checks
            yield
            return
        pool = AsyncConnectionPool(settings.database_url, min_size=1, max_size=5, open=False)
        await pool.open(wait=False)
        redis = Redis.from_url(settings.redis_url)

        async def pg_check() -> None:
            async with pool.connection(timeout=2) as conn:
                await conn.execute("SELECT 1")

        app.state.checks = {"postgres": pg_check, "redis": redis.ping}
        try:
            yield
        finally:
            await pool.close()
            await redis.aclose()

    app = FastAPI(title="kw-ai", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> JSONResponse:
        results: dict[str, str] = {}
        for name, check in app.state.checks.items():
            try:
                await check()
                results[name] = "ok"
            except Exception:
                results[name] = "fail"
        healthy = all(v == "ok" for v in results.values())
        body = {"service": "ai", "status": "ok" if healthy else "degraded", "checks": results}
        return JSONResponse(body, status_code=200 if healthy else 503)

    return app


app = create_app()
