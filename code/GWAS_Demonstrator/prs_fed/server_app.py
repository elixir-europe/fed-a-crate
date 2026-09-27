"""
Server-side application (Flower ServerApp).

Under the Flower Message API, the ServerApp is a single function decorated with
``@app.main()`` that orchestrates the entire federation. It is invoked by the
Flower runtime when a run is submitted, and executes to completion.

The function receives:

  * ``grid``    — the communication channel to the connected SuperNodes
  * ``context`` — runtime configuration (the ``[tool.flwr.app.config]`` block
                  from ``pyproject.toml``, plus any ``--run-config`` overrides)

Its responsibilities are:

  1. Build the initial (zeroed) model parameters.
  2. Instantiate the strategy.
  3. Run the federation via ``strategy.start(...)``, which blocks until all
     rounds complete and returns a ``Result``.
  4. Optionally emit an RO-Crate of the run and merge in the per-node
     provenance.
  5. Persist the final model, weights, and training history.

Provenance capture is optional. If the ``flwrcrate`` package is installed, the
run emits an RO-Crate describing the whole federation; otherwise this step is
skipped and the federation runs unchanged.
"""

import os
from pathlib import Path

import numpy as np

from flwr.app                import ArrayRecord, ConfigRecord, Context
from flwr.serverapp          import Grid, ServerApp

from prs_fed.strategy        import HistoryFedAvg
from prs_fed.model_io        import save_final_artifacts
from prs_fed.crate_merge     import merge_node_crates_into_run_crate
from flwrcrate import FLCrateTracker  # type: ignore[import]


app = ServerApp()


def _resolve_pyproject_path() -> str | None:
    """
    Locate ``pyproject.toml`` as an absolute path.

    The provenance layer reads ``pyproject.toml`` to capture framework versions
    and the metric-to-URI mapping. The ServerApp executes from the installed
    application bundle rather than the project directory, so a relative path
    would resolve incorrectly.

    The following locations are tried in order, and the first that exists is
    returned. If none exists, ``None`` is returned and the provenance layer
    falls back to its own default with reduced dependency capture.
    """
    candidates = []

    # 1. An explicit override via the PYPROJECT_PATH environment variable.
    env_path = os.environ.get("PYPROJECT_PATH")
    if env_path:
        candidates.append(Path(env_path))

    # 2. Beside the installed package.
    import prs_fed
    pkg_parent = Path(prs_fed.__file__).resolve().parent.parent
    candidates.append(pkg_parent / "pyproject.toml")

    # 3. The current working directory.
    candidates.append(Path.cwd() / "pyproject.toml")

    # 4. The container's working directory, where deployment images place it.
    candidates.append(Path("/app/pyproject.toml"))

    for c in candidates:
        if c.is_file():
            return str(c.resolve())
    return None


@app.main()
def main(grid: Grid, context: Context) -> None:
    # ── Pull config (with sensible defaults) ──────────────────────────────────
    cfg = context.run_config
    num_rounds   = int(cfg.get("num-server-rounds", 10))
    local_epochs = int(cfg.get("local-epochs",       5))
    n_features   = int(cfg.get("n-features",       313))
    threshold    = float(cfg.get("threshold",       0.5))
    results_dir  = str(cfg.get("results-dir", "/results"))

    # ── Initial global model parameters (all zeros) ───────────────────────────
    # The client's training handler uses these as the starting point. An
    # ArrayRecord wraps an ordered list of NumPy arrays.
    initial_arrays = ArrayRecord([
        np.zeros(n_features, dtype=np.float64),   # coefficients
        np.zeros(1,          dtype=np.float64),   # intercept
    ])

    # ── Per-round configuration sent to clients ──────────────────────────────
    # Clients read these from msg.content["config"].
    train_config    = ConfigRecord({"local-epochs": local_epochs})
    evaluate_config = ConfigRecord({"threshold":    threshold})

    # ── Strategy ──────────────────────────────────────────────────────────────
    strategy = HistoryFedAvg(
        fraction_train      = 1.0,
        fraction_evaluate   = 1.0,
        min_train_nodes     = 3,
        min_evaluate_nodes  = 3,
        min_available_nodes = 3,
    )
    strategy.summary()

    # ── Run the federation ────────────────────────────────────────────────────
    # When provenance capture is available, the run is wrapped so that an
    # RO-Crate of the federation is emitted. Evaluation is performed
    # client-side (no evaluate_fn is passed to start()), so the run uses
    # record_result() to read per-round metrics from the Result's client-side
    # aggregates rather than wrapping a server-side evaluation function.
    crate_out = os.path.join(results_dir, "fl_crate")

    pyproject_path = _resolve_pyproject_path()
    if pyproject_path is None:
        print("  [flwrcrate] WARNING: could not locate pyproject.toml; "
                "framework/dependency capture will be limited.")

    with FLCrateTracker(
        context, strategy,
        output_dir     = crate_out,                       # absolute path under results_dir
        pyproject_path = pyproject_path or "pyproject.toml",
        app_name       = "Federated PRS case/control classification across 3 nodes",
        author         = _build_author(cfg),
        license        = "https://github.com/elixir-europe/fed-a-crate?tab=MIT-1-ov-file",
    ) as tracker:
        result = strategy.start(
            grid            = grid,
            initial_arrays  = initial_arrays,
            num_rounds      = num_rounds,
            train_config    = train_config,
            evaluate_config = evaluate_config,
        )
        # Records per-round metrics from the Result's client-side aggregates.
        tracker.record_result(result)
    print(f"  [flwrcrate] RO-Crate written to {crate_out}/ro-crate/")

    # ── Merge per-node provenance into the run-crate ──────────────────────
    # Fold each node's RO-Crate (institute and location) into the run-crate
    # as contributor organisations on the run action, producing a single
    # self-contained provenance record.
    run_crate_path = os.path.join(crate_out, "ro-crate", "ro-crate-metadata.json")
    merge_status = merge_node_crates_into_run_crate(
        run_crate_path = run_crate_path,
        node_provenance = strategy._provenance,
    )
    if merge_status["written"]:
        merged = [t["cohort"] for t in merge_status["merged_nodes"]]
        print(f"  [provenance] Merged node crates into run-crate: {merged}")
    if merge_status["skipped_nodes"]:
        skipped = [(t["cohort"], t["reason"]) for t in merge_status["skipped_nodes"]]
        print(f"  [provenance] Skipped: {skipped}")
    for w in merge_status["warnings"]:
        print(f"  [provenance] WARNING: {w}")

    # ── Persist artefacts ─────────────────────────────────────────────────────
    # result.arrays holds the final aggregated parameters from the last round.
    coef, intercept = result.arrays.to_numpy_ndarrays()

    # Combine the strategy's per-node history with Flower's aggregated metrics.
    full_history = {
        "per_node"            : strategy._per_node_history,
        "aggregated_train"   : _round_records_to_dict(result.train_metrics_clientapp),
        "aggregated_evaluate": _round_records_to_dict(result.evaluate_metrics_clientapp),
    }

    paths = save_final_artifacts(
        coef        = coef,
        intercept   = intercept,
        history     = full_history,
        n_features  = n_features,
        n_rounds    = num_rounds,
        results_dir = results_dir,
    )

    print("\nFinal artefacts written:")
    for label, path in paths.items():
        print(f"  {label:>8}: {path}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_author(cfg) -> dict | str | None:
    """
    Build the crate author from run configuration.

    Reads ``author-name``, ``author-orcid``, and ``author-affiliation`` from
    the run config (settable in ``pyproject.toml`` or overridden per run with
    ``--run-config``). Returns a dictionary when a name is provided, otherwise
    ``None``.
    """
    name = str(cfg.get("author-name", "")).strip()
    if not name:
        return None
    author = {"name": name}
    orcid = str(cfg.get("author-orcid", "")).strip()
    if orcid:
        author["orcid"] = orcid
    affil = str(cfg.get("author-affiliation", "")).strip()
    if affil:
        author["affiliation"] = affil
    return author


def _round_records_to_dict(round_records) -> dict:
    """
    Convert Flower's ``{round_number: MetricRecord}`` history into plain
    dictionaries suitable for JSON serialisation.
    """
    if round_records is None:
        return {}
    return {
        int(r): {k: (v if isinstance(v, (int, float, str, bool)) else list(v))
                 for k, v in mr.items()}
        for r, mr in round_records.items()
    }