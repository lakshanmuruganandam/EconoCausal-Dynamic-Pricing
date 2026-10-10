"""Pydantic request models for the EconoCausal API."""
from typing import Literal

from pydantic import BaseModel, Field

from backend import config


class PipelineRequest(BaseModel):
    n: int = Field(config.DEFAULT_N_CUSTOMERS, ge=1_000, le=100_000, description="Customers to simulate")
    seed: int = Field(config.DEFAULT_SEED, ge=0, le=1_000_000)
    confounding: float = Field(config.DEFAULT_CONFOUNDING, ge=0.0, le=3.0,
                               description="Historical targeting bias (0 = randomised trial)")
    estimator: Literal["auto", "causal_forest", "linear_dml", "dr_learner"] = config.DEFAULT_ESTIMATOR
    budget: float = Field(config.DEFAULT_BUDGET, gt=0, le=10_000_000)


class OptimiseRequest(BaseModel):
    budget: float = Field(config.DEFAULT_BUDGET, gt=0, le=10_000_000)
    margin: float = Field(config.GROSS_MARGIN, gt=0, le=1)
    objective: Literal["profit", "revenue", "conversions"] = "profit"
    cost_basis: Literal["redemption", "issued"] = "redemption"
    risk_aversion: float = Field(config.RISK_AVERSION, ge=0, le=3,
                                 description="Plan on τ̂ − λ·σ̂ (0 = trust point estimates)")


class DriftRequest(BaseModel):
    scenario: Literal["stable", "price_war", "churn_wave", "new_market"] = "price_war"
    n: int = Field(5_000, ge=500, le=50_000)
    seed: int = Field(2026, ge=0)
