from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "backend/.env", "../.env"), extra="ignore")

    env: str = "local"
    demo_mode: bool = False
    database_url: str = "postgresql://brandguard:brandguard@localhost:5432/brandguard"
    cors_origins: str = "http://localhost:5173"
    supabase_url: str = ""
    supabase_jwt_audience: str = "authenticated"
    # Only for older projects that still sign tokens with a shared secret (HS256). Leave empty otherwise.
    supabase_jwt_secret: str = ""
    llm_enabled: bool = True
    llm_provider: str = "gemini"

    @field_validator("database_url")
    @classmethod
    def use_psycopg3_driver(cls, value: str) -> str:
        # Supabase and Render hand out plain postgresql:// URLs.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
