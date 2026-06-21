import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import time
from uuid import uuid4

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

from app import models  # noqa: F401
from app.api.routes_applications import router as applications_router
from app.api.routes_auth import router as auth_router
from app.api.routes_tests import router as tests_router
from app.core.config import get_settings
from app.core.security import generate_random_password, get_password_hash
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.user import User, UserRole
from app.services.check_runner import check_loop
from app.services.sample_data import seed_startup_checks_from_csv

settings = get_settings()


def _write_password_hint(password_path: str, password: str) -> None:
    path = Path(password_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(password, encoding="utf-8")


def _bootstrap_user(*, username: str, configured_password: str | None, password_length: int, password_path: str, is_admin: bool, role: str, label: str) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        password_to_report: str | None = None
        generated_password = False

        if user:
            user.is_admin = is_admin
            user.role = role
            if configured_password:
                user.password_hash = get_password_hash(configured_password)
                password_to_report = configured_password
        else:
            password_to_report = configured_password or generate_random_password(password_length)
            generated_password = configured_password is None
            user = User(
                username=username,
                password_hash=get_password_hash(password_to_report),
                is_admin=is_admin,
                role=role,
            )
            db.add(user)
        db.commit()

        if password_to_report:
            _write_password_hint(password_path, password_to_report)

        if generated_password:
            print(f"{label} credentials generated -> username: {username} password: {password_to_report}", flush=True)
        elif password_to_report:
            print(f"{label} credentials loaded from configuration -> username: {username}", flush=True)
        else:
            print(f"{label} credentials preserved -> username: {username}", flush=True)
    finally:
        db.close()


def bootstrap_admin_user() -> None:
    _bootstrap_user(
        username=settings.admin_username,
        configured_password=settings.admin_password,
        password_length=settings.admin_password_length,
        password_path=settings.admin_password_env_path,
        is_admin=True,
        role=UserRole.ADMIN,
        label="Admin",
    )


def bootstrap_readonly_user() -> None:
    _bootstrap_user(
        username=settings.readonly_username,
        configured_password=settings.readonly_password,
        password_length=settings.readonly_password_length,
        password_path=settings.readonly_password_env_path,
        is_admin=False,
        role=UserRole.READONLY,
        label="Readonly",
    )


def migrate_user_roles() -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as connection:
        if "role" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'owner'"))
        connection.execute(text("UPDATE users SET role = 'admin' WHERE is_admin = true"))
        connection.execute(text("UPDATE users SET role = 'owner' WHERE is_admin = false AND (role IS NULL OR role = '')"))


def bootstrap_startup_seed() -> None:
    db = SessionLocal()
    try:
        try:
            seed_startup_checks_from_csv(db)
        except Exception as exc:
            db.rollback()
            print(f"Startup seed skipped due to error: {exc}", flush=True)
    finally:
        db.close()


def initialize_database(retries: int = 30, delay_seconds: int = 2) -> None:
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            migrate_user_roles()
            bootstrap_admin_user()
            bootstrap_readonly_user()
            bootstrap_startup_seed()
            return
        except OperationalError:
            if attempt == retries:
                raise
            time.sleep(delay_seconds)


async def run_background_services(stop_event: asyncio.Event) -> None:
    await check_loop(stop_event)


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup_started = time.perf_counter()
    await asyncio.to_thread(initialize_database)
    print(f"Startup initialization completed in {(time.perf_counter() - startup_started) * 1000:.1f} ms", flush=True)

    stop_event = asyncio.Event()
    task = asyncio.create_task(run_background_services(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await task


app = FastAPI(title="StatusCake Home Made", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(applications_router)
app.include_router(tests_router)


@app.middleware("http")
async def log_request_timing(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid4().hex[:12]
    started = time.perf_counter()
    print(f"[request-start] id={request_id} method={request.method} path={request.url.path}", flush=True)
    try:
        response = await call_next(request)
    except Exception as exc:
        duration_ms = (time.perf_counter() - started) * 1000
        print(
            f"[request-error] id={request_id} method={request.method} path={request.url.path} "
            f"duration_ms={duration_ms:.1f} error={type(exc).__name__}",
            flush=True,
        )
        raise

    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-Id"] = request_id
    print(
        f"[request-end] id={request_id} method={request.method} path={request.url.path} "
        f"status={response.status_code} duration_ms={duration_ms:.1f}",
        flush=True,
    )
    return response


@app.get("/health")
def health():
    return {"status": "ok"}
