"""
RO-Crate loading, validation, and summarisation.

Each node ships an RO-Crate (``ro-crate-metadata.json``) describing its
institute, location, and organisational provenance. The client loads this
crate from a fixed path, validates its basic structure, and sends it verbatim
to the server, where it is folded into the run's provenance record.

This module has no Flower dependency so it can be tested in isolation and
reused by both the client and the server.

An RO-Crate is a JSON-LD document: a flat ``@graph`` list of entities, each
identified by ``@id`` and cross-referenced by that identifier. Navigation is
performed by indexing the graph on ``@id`` and following references.
"""

import json
import os
from typing import Any, Optional


CRATE_FIXED_PATH = "/provenance/ro-crate-metadata.json"


# ── Loading ───────────────────────────────────────────────────────────────────

def load_crate(path: str = CRATE_FIXED_PATH) -> Optional[dict]:
    """
    Load and parse the RO-Crate at ``path``.

    Returns the parsed dictionary, or ``None`` if the file is missing or
    cannot be parsed. This function never raises: provenance capture is
    best-effort, and a missing or malformed crate must not prevent the
    federation from running.
    """
    if not os.path.exists(path):
        print(f"  [provenance] No RO-Crate found at {path}; "
              "continuing with empty provenance.")
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            crate = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  [provenance] Failed to read/parse RO-Crate at {path}: "
              f"{e.__class__.__name__}; continuing with empty provenance.")
        return None

    ok, reason = validate_crate(crate)
    if not ok:
        print(f"  [provenance] RO-Crate at {path} is malformed ({reason}); "
              "continuing with empty provenance.")
        return None

    return crate


# ── Validation ────────────────────────────────────────────────────────────────

def validate_crate(crate: Any) -> tuple[bool, str]:
    """
    Perform a lightweight structural check that ``crate`` looks like an
    RO-Crate. This is not full JSON-LD validation; it is enough to catch a
    hand-authoring mistake before the crate is sent to the server.

    Returns a ``(is_valid, reason)`` tuple, where ``reason`` is an empty
    string when the crate is valid.
    """
    if not isinstance(crate, dict):
        return False, "top level is not a JSON object"
    if "@context" not in crate:
        return False, "missing @context"
    if "@graph" not in crate or not isinstance(crate["@graph"], list):
        return False, "missing or non-list @graph"

    # Every entity must carry an @id (the cross-reference key).
    for i, entity in enumerate(crate["@graph"]):
        if not isinstance(entity, dict) or "@id" not in entity:
            return False, f"@graph entity {i} has no @id"

    # A well-formed crate includes the metadata descriptor entity.
    ids = {e["@id"] for e in crate["@graph"]}
    if "ro-crate-metadata.json" not in ids:
        return False, "no ro-crate-metadata.json descriptor entity"

    return True, ""


# ── Summarisation ─────────────────────────────────────────────────────────────

def _index_by_id(crate: dict) -> dict[str, dict]:
    return {e["@id"]: e for e in crate.get("@graph", [])}


def _resolve(by_id: dict, ref: Any) -> Optional[dict]:
    """Follow a {'@id': '...'} reference to its entity, if present."""
    if isinstance(ref, dict) and "@id" in ref:
        return by_id.get(ref["@id"])
    return None


def summarise_crate(crate: Optional[dict]) -> dict:
    """
    Extract the human-relevant provenance fields into a flat dictionary, so a
    reader does not have to parse JSON-LD to identify a node.

    The extraction follows the expected crate structure::

        Root (./) --about--> Organization --location--> GeoCoordinates --address--> PostalAddress

    Every field is optional; missing pieces are returned as ``None``. If
    ``crate`` is ``None``, all fields are ``None``.
    """
    summary = {
        "institute_name": None,
        "institute_url" : None,
        "institute_ror" : None,
        "date_published": None,
        "latitude"      : None,
        "longitude"     : None,
        "country"       : None,
        "locality"      : None,
        "region"        : None,
        "postal_code"   : None,
        "street_address": None,
    }
    if not crate:
        return summary

    by_id = _index_by_id(crate)

    # Root data entity: prefer "./" but fall back to the first Dataset.
    root = by_id.get("./")
    if root is None:
        root = next((e for e in crate["@graph"]
                     if "Dataset" in _as_list(e.get("@type"))), None)
    if root is None:
        return summary

    summary["date_published"] = root.get("datePublished")

    # Root --about--> Organization
    org = _resolve(by_id, root.get("about"))
    if org is not None:
        summary["institute_name"] = org.get("name")
        summary["institute_url"]  = org.get("url")
        # The ROR identifier is the organisation's @id when it is a ror.org URI.
        org_id = org.get("@id", "")
        if "ror.org" in org_id:
            summary["institute_ror"] = org_id

        # Organization --location--> GeoCoordinates
        geo = _resolve(by_id, org.get("location"))
        if geo is not None:
            summary["latitude"]  = geo.get("latitude")
            summary["longitude"] = geo.get("longitude")

            # GeoCoordinates --address--> PostalAddress (may be inline or ref)
            addr = geo.get("address")
            if isinstance(addr, dict) and "@id" in addr and "addressCountry" not in addr:
                addr = _resolve(by_id, addr) or addr
            if isinstance(addr, dict):
                summary["country"]        = addr.get("addressCountry")
                summary["locality"]       = addr.get("addressLocality")
                summary["region"]         = addr.get("addressRegion")
                summary["postal_code"]    = addr.get("postalCode")
                summary["street_address"] = addr.get("streetAddress")

    return summary


def _as_list(value: Any) -> list:
    """@type may be a string or a list; normalise to a list."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]
