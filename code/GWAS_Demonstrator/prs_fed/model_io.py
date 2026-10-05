"""
Persistence of the final aggregated model and training history.

Called once the federation completes, this module writes:

  * ``prs_global_model.pkl``    — the trained scikit-learn model, ready for
    ``predict_proba``
  * ``prs_global_weights.npz``  — the raw coefficient and intercept arrays
  * ``training_history.json``   — per-round, per-node metrics and run metadata

Provenance (the RO-Crate) is handled separately by the provenance-capture
layer and ``crate_merge``; it is not written here.
"""

import json
import os
import pickle
from datetime import datetime, timezone

import numpy as np

from prs_fed.task import create_model, set_parameters


def save_final_artifacts(
    coef            : np.ndarray,
    intercept       : np.ndarray,
    history         : dict,
    n_features      : int,
    n_rounds        : int,
    results_dir     : str,
) -> dict[str, str]:
    """Write model, weights, and history; return a dict of paths."""
    os.makedirs(results_dir, exist_ok=True)
    paths: dict[str, str] = {}

    # Raw NumPy weights (framework-agnostic; load with numpy.load).
    npz_path = os.path.join(results_dir, "prs_global_weights.npz")
    np.savez(npz_path, coef=coef, intercept=intercept)
    paths["weights"] = npz_path

    # Pickled scikit-learn model, ready for predict_proba.
    model = create_model()
    set_parameters(model, [coef, intercept])
    pkl_path = os.path.join(results_dir, "prs_global_model.pkl")
    with open(pkl_path, "wb") as f:
        pickle.dump(model, f)
    paths["model"] = pkl_path

    return paths