from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Test(Base):
    __tablename__ = "tests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    endpoint: Mapped[str] = mapped_column(String(500))
    method: Mapped[str] = mapped_column(String(10))
    expected_result: Mapped[str] = mapped_column(Text)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    frequency_seconds: Mapped[int] = mapped_column(Integer, default=15)
    success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_result_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_http_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_result_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    previous_response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    response_time_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    application = relationship("Application", back_populates="tests")
    incidents = relationship("Incident", back_populates="test", cascade="all, delete-orphan")
    check_results = relationship("CheckResult", back_populates="test", cascade="all, delete-orphan")
