from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://statuscake:statuscake@db:5432/statuscake"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60 * 24
    admin_username: str = "admin"
    admin_password: str | None = None
    admin_password_env_path: str = "/tmp/generated_admin_password.txt"
    admin_password_length: int = 20
    sample_data_size: int = 180
    frontend_origin: str = "http://localhost:5173"
    startup_seed_csv_path: str = "/app/data/samplechecks.csv"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
