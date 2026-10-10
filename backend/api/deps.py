"""Shared FastAPI dependencies."""
from fastapi import HTTPException

from backend.causal.engine import State, engine


def state_or_409() -> State:
    try:
        return engine.require()
    except LookupError:
        raise HTTPException(409, f"pipeline not ready ({engine.status['message']})")
