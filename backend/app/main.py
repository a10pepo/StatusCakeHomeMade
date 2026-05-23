import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from app import models  # noqa: F401
from app.api.routes_applications import router as applications_router
from app.api.routes_auth import router as auth_router
from app.api.routes_sample_data import router as sample_data_router
from app.api.routes_tests import router as tests_router
from app.core.config import get_settings
from app.core.security import generate_random_password, get_password_hash
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.user import User
from app.services.check_runner import check_loop
from app.services.sample_data import seed_startup_checks_from_csv

settings = get_settings()


def bootstrap_admin_user() -> None:
    db = SessionLocal()
    try:
        password = settings.admin_password or generate_random_password(settings.admin_password_length)
        admin = db.query(User).filter(User.username == settings.admin_username).first()
        if admin:
            admin.password_hash = get_password_hash(password)
            admin.is_admin = True
        else:
            admin = User(
                username=settings.admin_username,
                password_hash=get_password_hash(password),
                is_admin=True,
            )
            db.add(admin)
        db.commit()

        password_path = Path(settings.admin_password_env_path)
        password_path.parent.mkdir(parents=True, exist_ok=True)
        password_path.write_text(password, encoding="utf-8")
        print(f"Admin credentials ready -> username: {settings.admin_username} password: {password}", flush=True)
    finally:
        db.close()


def bootstrap_startup_seed() -> None:
    db = SessionLocal()
    try:
        seed_startup_checks_from_csv(db)
    finally:
        db.close()


def initialize_database(retries: int = 30, delay_seconds: int = 2) -> None:
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            bootstrap_admin_user()
            bootstrap_startup_seed()
            return
        except OperationalError:
            if attempt == retries:
                raise
            time.sleep(delay_seconds)


async def run_background_services(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(initialize_database)
            break
        except OperationalError:
            await asyncio.sleep(5)

    if stop_event.is_set():
        return

    await check_loop(stop_event)


@asynccontextmanager
async def lifespan(_: FastAPI):
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
app.include_router(sample_data_router)


@app.get("/health")
def health():
    return {"status": "ok"}
