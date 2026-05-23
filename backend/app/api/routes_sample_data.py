from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.history import SampleDataStatus
from app.services.sample_data import clear_sample_data, get_or_create_sample_state, load_sample_data

router = APIRouter(prefix="/api/sample-data", tags=["sample-data"])


@router.get("", response_model=SampleDataStatus)
def get_sample_data_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    state = get_or_create_sample_state(db)
    return SampleDataStatus(loaded=state.is_loaded, loaded_at=state.loaded_at)


@router.post("/load", response_model=SampleDataStatus)
def load_sample_data_route(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    state = load_sample_data(db)
    return SampleDataStatus(loaded=state.is_loaded, loaded_at=state.loaded_at)


@router.delete("", response_model=SampleDataStatus)
def clear_sample_data_route(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    state = clear_sample_data(db)
    return SampleDataStatus(loaded=state.is_loaded, loaded_at=state.loaded_at)
