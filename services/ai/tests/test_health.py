from fastapi.testclient import TestClient

from kw_ai.app import create_app


async def ok() -> None:
    return None


async def fail() -> None:
    raise ConnectionError("down")


def test_health_ok() -> None:
    with TestClient(create_app({"postgres": ok, "redis": ok})) as client:
        res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"service": "ai", "status": "ok", "checks": {"postgres": "ok", "redis": "ok"}}


def test_health_reports_failing_dependency() -> None:
    with TestClient(create_app({"postgres": fail, "redis": ok})) as client:
        res = client.get("/health")
    assert res.status_code == 503
    assert res.json()["checks"]["postgres"] == "fail"
