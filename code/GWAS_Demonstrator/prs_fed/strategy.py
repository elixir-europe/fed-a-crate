"""
A FedAvg strategy that additionally records per-node, per-round metrics.

The built-in ``FedAvg`` provides sample-weighted averaging of model weights
and metrics, along with all client-sampling logic. It retains only the
*aggregated* metrics for each round, not the per-client breakdown.

``HistoryFedAvg`` overrides the two aggregation hooks to capture each node's
training and evaluation metrics (and its provenance crate) before delegating
the actual aggregation to the base class. The captured history is written to
``training_history.json`` and the provenance is merged into the run-crate.

If per-node history is not required, this subclass can be removed and
``flwr.serverapp.strategy.FedAvg`` used directly.
"""

from flwr.app              import Message, MetricRecord
from flwr.serverapp.strategy import FedAvg


class HistoryFedAvg(FedAvg):
    """FedAvg that also tracks per-node metrics for each round."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # These attributes hold internal run state, not strategy
        # hyperparameters. They are prefixed with an underscore deliberately:
        # the provenance-capture layer records a strategy's public attributes
        # as hyperparameters by iterating dir(strategy) and skipping names that
        # begin with "_". Keeping these private prevents them from appearing in
        # the run-crate as spurious, empty hyperparameter entries.
        #
        # For the same reason, no public property accessors are provided; the
        # server reads these as ``strategy._per_node_history`` and
        # ``strategy._provenance``.
        self._per_node_history: dict[str, dict[int, dict]] = {
            "train": {},
            "evaluate": {},
        }
        # Maps node_num -> {"cohort": str, "crate_json": str, "present": bool}.
        # The crate is identical every round; the latest seen value is kept.
        self._provenance: dict[int, dict] = {}

    def _capture_provenance(self, meta, node_num: int, cohort: str) -> None:
        """Record a node's RO-Crate from the ``meta`` ConfigRecord of its reply."""
        if meta is None:
            return
        crate_json = str(meta.get("ro-crate", ""))
        present    = bool(meta.get("ro-crate-present", False))
        self._provenance[node_num] = {
            "cohort"    : cohort,
            "crate_json": crate_json,
            "present"   : present,
        }

    def aggregate_train(self, server_round, replies):
        per_node = {}
        for r in replies:
            if r.has_error():
                continue
            mr   = r.content.get("metrics")
            meta = r.content.get("meta")        # ConfigRecord carrying identity
            if mr is None:
                continue
            # Identity (node number, cohort) is read from the non-aggregated
            # ConfigRecord rather than the MetricRecord, which FedAvg averages.
            node_num = int(meta["node-num"]) if meta is not None else 0
            cohort  = str(meta["cohort"])  if meta is not None else "?"
            self._capture_provenance(meta, node_num, cohort)
            per_node[node_num] = {
                "cohort"      : cohort,
                "train-auc"   : float(mr.get("train-auc",  float("nan"))),
                "train-f1"    : float(mr.get("train-f1",   float("nan"))),
                "train-acc"   : float(mr.get("train-acc",  float("nan"))),
                "num-examples": int(mr.get("num-examples", 0)),
            }
        self._per_node_history["train"][server_round] = per_node

        # Delegate weight and metric aggregation to the base implementation.
        return super().aggregate_train(server_round, replies)

    def aggregate_evaluate(self, server_round, replies):
        per_node = {}
        for r in replies:
            if r.has_error():
                continue
            mr   = r.content.get("metrics")
            meta = r.content.get("meta")
            if mr is None:
                continue
            node_num = int(meta["node-num"]) if meta is not None else 0
            cohort  = str(meta["cohort"])  if meta is not None else "?"
            self._capture_provenance(meta, node_num, cohort)
            per_node[node_num] = {
                "cohort"      : cohort,
                "test-auc"    : float(mr.get("test-auc",  float("nan"))),
                "test-acc"    : float(mr.get("test-acc",  float("nan"))),
                "test-f1"     : float(mr.get("test-f1",   float("nan"))),
                "test-prec"   : float(mr.get("test-prec", float("nan"))),
                "test-rec"    : float(mr.get("test-rec",  float("nan"))),
                "test-ll"     : float(mr.get("test-ll",   float("nan"))),
                "num-examples": int(mr.get("num-examples", 0)),
            }
        self._per_node_history["evaluate"][server_round] = per_node

        return super().aggregate_evaluate(server_round, replies)