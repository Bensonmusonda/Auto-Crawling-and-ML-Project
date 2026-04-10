"""
auth_router.py — JWT-based authentication (register / login / me)

Endpoints:
  POST /auth/register  – create a new user account, returns a JWT
  POST /auth/login     – verify credentials, returns a JWT
  GET  /auth/me        – validate token and return the current user
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel

# ── Config ────────────────────────────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "supersecretkey_changeme_in_prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 8  # 8 hours — plenty for a presentation

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# ── Utilities ─────────────────────────────────────────────────────────────────
# Use bcrypt directly — passlib's bcrypt backend breaks on bcrypt >= 4.x
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── DB helpers ────────────────────────────────────────────────────────────────
def get_db_conn():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def ensure_users_table():
    """Create the users table if it doesn't already exist."""
    with get_db_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id          SERIAL PRIMARY KEY,
                username    TEXT UNIQUE NOT NULL,
                email       TEXT UNIQUE,
                hashed_pw   TEXT NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        conn.commit()


# Call once at import time (safe to call repeatedly)
try:
    ensure_users_table()
except Exception as exc:
    # Don't crash startup if DB isn't ready yet — it will be ready before
    # any request hits this router.
    print(f"[auth] Could not ensure users table on startup: {exc}")


# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class UserOut(BaseModel):
    id: int
    username: str
    email: Optional[str]


# ── Internal helpers ──────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_user(username: str) -> Optional[dict]:
    with get_db_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = %s", (username,)
        ).fetchone()
    return row


# ── Dependency: current authenticated user ────────────────────────────────────
def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    user = get_user(username)
    if not user:
        raise credentials_exc
    return user


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=201)
def register(body: RegisterRequest):
    """Register a new user and return a JWT."""
    if get_user(body.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )

    hashed = hash_password(body.password)
    try:
        with get_db_conn() as conn:
            conn.execute(
                "INSERT INTO users (username, email, hashed_pw) VALUES (%s, %s, %s)",
                (body.username, body.email, hashed),
            )
            conn.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB error: {exc}")

    token = create_token(body.username)
    return TokenResponse(access_token=token, username=body.username)


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends()):
    """Authenticate with username + password and return a JWT."""
    user = get_user(form.username)
    if not user or not verify_password(form.password, user["hashed_pw"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_token(form.username)
    return TokenResponse(access_token=token, username=form.username)


@router.get("/me", response_model=UserOut)
def me(current_user: dict = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return UserOut(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user.get("email"),
    )
