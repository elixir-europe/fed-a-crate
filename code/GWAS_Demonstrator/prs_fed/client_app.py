"""
node-side application (Flower ClientApp).

Under the Flower Message API a ClientApp is defined by decorating handler
functions rather than subclassing a client base class. The ``@app.train`` and
``@app.evaluate`` handlers each receive a ``Message`` and return one. A handler:

  1. Reads the global model weights from ``msg.content["arrays"]``.
  2. Reads per-round configuration from ``msg.content["config"]``.
  3. Performs local training or evaluation on this node's private cohort.
  4. Returns a reply ``Message`` containing the updated weights (training
     only), a ``MetricRecord``, and a ``ConfigRecord`` carrying this node's
     identity and provenance.

``Context.node_config`` carries the configuration passed to this SuperNode at
startup (the local CSV path, cohort label, and node number), set via the
``--node-config`` flag in the deployment configuration.
"""

import json

from flwr.app       import ArrayRecord, ConfigRecord, Context, Message, MetricRecord, RecordDict
from flwr.clientapp import ClientApp

from prs_fed.task       import (
    create_model, set_parameters, evaluate_model, load_local_cohort,
)
from prs_fed.provenance import load_crate, CRATE_FIXED_PATH


# ── Per-process cache ─────────────────────────────────────────────────────────
# Loading the cohort CSV is expensive (tens of thousands of rows by hundreds
# of SNP columns). The SuperNode keeps this process alive across rounds, so the
# loaded arrays are cached on first use and reused on every subsequent round.

_local_data: dict | None = None


def _get_local_data(context: Context) -> dict:
    """Load (and cache) this node's cohort. Triggered on first call."""
    global _local_data
    if _local_data is not None:
        return _local_data

    csv_path     = str(context.node_config.get("cohort-csv", "/data/cohort.csv"))
    cohort_label = str(context.node_config.get("cohort-label", "cohort"))
    node_num      = int(context.node_config.get("node-num", 0))

    X_train, X_test, y_train, y_test, _scaler, meta = load_local_cohort(csv_path)

    # Load this node's RO-Crate once, from the fixed path. Returns None (with a
    # warning) if the crate is missing or malformed, in which case the
    # federation proceeds with empty provenance. The serialised string is
    # cached so it need not be re-serialised on every round.
    crate = load_crate(CRATE_FIXED_PATH)
    crate_json = json.dumps(crate) if crate is not None else ""

    _local_data = dict(
        X_train      = X_train,
        X_test       = X_test,
        y_train      = y_train,
        y_test       = y_test,
        cohort_label = cohort_label,
        node_num      = node_num,
        meta         = meta,
        crate_json   = crate_json,
        crate_present= crate is not None,
    )
    return _local_data


# ── The ClientApp ─────────────────────────────────────────────────────────────

app = ClientApp()


@app.train()
def train(msg: Message, context: Context) -> Message:
    """Local training step. Runs on the node for one federation round."""
    data         = _get_local_data(context)
    local_epochs = int(msg.content["config"].get("local-epochs", 5))

    # Receive the global model weights from the server
    arrays = msg.content["arrays"]
    coef, intercept = arrays.to_numpy_ndarrays()

    # Initialise local model with the global weights
    model = create_model()
    set_parameters(model, [coef, intercept])

    # Train locally
    for _ in range(local_epochs):
        model.partial_fit(data["X_train"], data["y_train"], classes=[0, 1])

    # Build reply: updated weights + training metrics
    train_metrics = evaluate_model(model, data["X_train"], data["y_train"])

    updated_arrays = ArrayRecord([model.coef_[0], model.intercept_])
    metrics = MetricRecord({
        # FedAvg sample-weight-averages every key in a MetricRecord. Only
        # genuine numeric metrics belong here; identifiers such as the node
        # number must not, or they would be averaged into a meaningless value.
        # "num-examples" is the default key FedAvg uses for the sample weight.
        "num-examples": data["meta"]["n_train"],
        "train-auc"   : train_metrics["auc"],
        "train-f1"    : train_metrics["f1"],
        "train-acc"   : train_metrics["accuracy"],
    })

    # Identity and provenance travel in a ConfigRecord, which FedAvg does not
    # aggregate. The RO-Crate is sent verbatim as a JSON string, since a
    # ConfigRecord cannot hold nested objects.
    meta = ConfigRecord({
        "node-num"       : data["node_num"],
        "cohort"         : data["cohort_label"],
        "ro-crate"       : data["crate_json"],
        "ro-crate-present": data["crate_present"],
    })

    content = RecordDict({"arrays": updated_arrays, "metrics": metrics, "meta": meta})
    return Message(content=content, reply_to=msg)


@app.evaluate()
def evaluate(msg: Message, context: Context) -> Message:
    """Local evaluation step. Score the global model on this node's test set."""
    data      = _get_local_data(context)
    threshold = float(msg.content["config"].get("threshold", 0.5))

    arrays = msg.content["arrays"]
    coef, intercept = arrays.to_numpy_ndarrays()

    model = create_model()
    set_parameters(model, [coef, intercept])

    m = evaluate_model(model, data["X_test"], data["y_test"], threshold=threshold)

    metrics = MetricRecord({
        "num-examples": data["meta"]["n_test"],
        "test-auc"    : m["auc"],
        "test-acc"    : m["accuracy"],
        "test-f1"     : m["f1"],
        "test-prec"   : m["precision"],
        "test-rec"    : m["recall"],
        "test-ll"     : m["log_loss_val"],
    })

    # Identity and provenance in a ConfigRecord (not aggregated).
    meta = ConfigRecord({
        "node-num"       : data["node_num"],
        "cohort"         : data["cohort_label"],
        "ro-crate"       : data["crate_json"],
        "ro-crate-present": data["crate_present"],
    })

    # An evaluation reply carries metrics only; no weights are returned.
    content = RecordDict({"metrics": metrics, "meta": meta})
    return Message(content=content, reply_to=msg)
