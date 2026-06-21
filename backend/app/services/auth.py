from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.user import User, UserRole
from app.schemas.auth import LoginRequest, UserCreate


def register_user(db: Session, payload: UserCreate) -> User:
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")

    user = User(
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        is_admin=False,
        role=UserRole.OWNER,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def login_user(db: Session, payload: LoginRequest) -> str:
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return create_access_token(str(user.id))
