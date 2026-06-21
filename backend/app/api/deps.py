from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.application import Application
from app.models.test import Test
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    subject = decode_access_token(token)
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == int(subject)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin_or_owner(application: Application, current_user: User) -> None:
    if current_user.is_admin:
        return
    if application.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")


def can_manage_projects(current_user: User) -> bool:
    return current_user.is_admin or current_user.role == UserRole.OWNER


def can_manage_tests(application: Application, current_user: User) -> bool:
    if current_user.is_admin:
        return True
    if current_user.role == UserRole.READONLY:
        return False
    return application.owner_id == current_user.id


def can_limited_update_application(application: Application, current_user: User) -> bool:
    if current_user.is_admin:
        return True
    if current_user.role == UserRole.READONLY:
        return True
    return application.owner_id == current_user.id


def can_limited_update_test(test: Test, current_user: User) -> bool:
    if current_user.is_admin:
        return True
    if current_user.role == UserRole.READONLY:
        return True
    return test.application.owner_id == current_user.id


def require_project_management(current_user: User) -> None:
    if not can_manage_projects(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")


def require_admin(current_user: User) -> None:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
