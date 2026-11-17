from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    database_url: str = "postgresql://kw:kw@localhost:5432/kw"
    redis_url: str = "redis://localhost:6379"
    ai_port: int = 8000
    web_origin: str = "http://localhost:3000"


settings = Settings()
