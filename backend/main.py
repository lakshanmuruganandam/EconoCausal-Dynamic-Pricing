"""
EconoCausal API entry point.

    uvicorn backend.main:app --reload --port 8000

On startup the default synthetic campaign is generated and the full causal
pipeline runs in the background; the dashboard shows live progress.
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from backend import config
from backend.api import routes_causal, routes_lab, routes_model, routes_optimize, routes_pipeline
from backend.causal.engine import RunConfig, engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("ECONOCAUSAL_AUTORUN", "1") == "1" and engine.state is None and not engine.busy:
        engine.start(RunConfig())
    yield


app = FastAPI(
    title=config.API_TITLE,
    version=config.API_VERSION,
    description="Dynamic pricing via Double Machine Learning: causal uplift, refutation and budget optimisation.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

for module in (routes_pipeline, routes_causal, routes_model, routes_optimize, routes_lab):
    app.include_router(module.router)


@app.get("/")
def root():
    return {"service": config.API_TITLE, "docs": "/docs", "status": engine.status["state"]}
