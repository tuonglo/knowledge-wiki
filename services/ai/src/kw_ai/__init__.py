def main() -> None:
    import uvicorn

    from kw_ai.settings import settings

    uvicorn.run("kw_ai.app:app", host="0.0.0.0", port=settings.ai_port)
