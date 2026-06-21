from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ApplicationCreate(BaseModel):
    name: str
    url: str


class ApplicationUpdate(BaseModel):
    name: str
    url: str
    owner_id: int | None = None


class ApplicationConfigResponse(BaseModel):
    id: int
    name: str
    url: str
    owner_id: int
    owner_username: str
    created_at: datetime
    tests_count: int

    model_config = ConfigDict(from_attributes=True)


class ApplicationResponse(ApplicationConfigResponse):
    healthy_score: float
    current_health: float

    model_config = ConfigDict(from_attributes=True)
