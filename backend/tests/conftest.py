import os

import pytest

os.environ["ECONOCAUSAL_AUTORUN"] = "0"


@pytest.fixture(scope="session")
def small_df():
    from backend.causal.data import generate_dataset

    return generate_dataset(n=4000, seed=11)


@pytest.fixture(scope="session")
def ready_engine():
    """Run the full pipeline once on a small dataset with the fastest estimator."""
    from backend.causal.engine import RunConfig, engine

    engine.start(RunConfig(n=4000, seed=11, estimator="linear_dml", budget=1500), background=False)
    assert engine.status["state"] == "ready", engine.status
    return engine
