"""
generate_node_crates.py — Generate per-node RO-Crate provenance metadata.

Produces one ``ro-crate-metadata.json`` per node, each describing the
contributing institution, its location, and the people involved.
"""

from pathlib import Path

from rocrate.rocrate import ROCrate
from rocrate.model.contextentity import ContextEntity
from rocrate.model.person import Person


# ── Parent institution (shared across all nodes) ──────────────────────────────

PARENT_ROR   = "https://ror.org/01ee9ar58"
PARENT_NAME  = "University of Nottingham"
PARENT_URL   = "https://www.nottingham.ac.uk"

GEO_ID = "https://www.geonames.org/10858713/university-of-nottingham.html"
GEO_PROPERTIES = {
    "@type": "https://schema.org/GeoCoordinates",
    "latitude": "52.941686822260635",
    "longitude": "-1.1871061808863315",
    "address": {
        "@id": GEO_ID,
        "@type": "https://schema.org/PostalAddress",
        "addressLocality": "University Park, Nottingham",
        "addressRegion": "Nottinghamshire",
        "addressCountry": "UK",
        "streetAddress": "Biodiscovery Institute",
        "postalCode": "NG7 2RD",
    },
}

# ── People (shared across all nodes; ORCID as @id where available) ─────────────

PEOPLE = [
    {"id": "https://orcid.org/0000-0002-7912-4203", "name": "Thomas Rowlands"},
    # Replace this @id with Tim Beck's real ORCID. If he does not have one, a
    # stable local identifier such as "#person-tim-beck" is also valid.
    {"id": "https://orcid.org/0000-0002-0292-7972", "name": "Tim Beck"},
]

# ── Per-node definitions ───────────────────────────────────────────────────────
# Each node becomes a distinct sub-organisation. The sub-org @id is what makes
# the three records distinct in the merged crate. Here the @id is derived from
# the parent ROR with a fragment suffix, which keeps the link to the real
# institution explicit while remaining unique per node.

nodes = [
    {"key": "USA_young",  "suborg_suffix": "node-young",
     "suborg_name": "University of Nottingham — Young Cohort Node"},
    {"key": "USA_old",    "suborg_suffix": "node-old",
     "suborg_name": "University of Nottingham — Older Cohort Node"},
    {"key": "USA_normal", "suborg_suffix": "node-normal",
     "suborg_name": "University of Nottingham — Reference Cohort Node"},
]

OUTPUT_ROOT = Path("provenance")


def build_crate(node: dict) -> ROCrate:
    """Build the RO-Crate for a single node."""
    crate = ROCrate()

    # Shared geo + parent institution
    geo = ContextEntity(crate, identifier=GEO_ID, properties=GEO_PROPERTIES)
    crate.add(geo)

    parent = ContextEntity(crate, identifier=PARENT_ROR, properties={
        "@type": "Organization",
        "name": PARENT_NAME,
        "url": PARENT_URL,
        "location": geo,
    })
    crate.add(parent)

    # People
    people = []
    for p in PEOPLE:
        person = Person(crate, p["id"], properties={
            "name": p["name"],
            "affiliation": parent,
        })
        crate.add(person)
        people.append(person)

    # Distinct sub-organisation for this node
    suborg_id = f"{PARENT_ROR}#{node['suborg_suffix']}"
    suborg = ContextEntity(crate, identifier=suborg_id, properties={
        "@type": "Organization",
        "name": node["suborg_name"],
        "parentOrganization": parent,
        "location": geo,
        "member": people,
    })
    crate.add(suborg)

    # The root dataset is "about" this node's sub-organisation, so the
    # summariser (root -> about -> Organization) resolves to the distinct
    # sub-org rather than the shared parent.
    crate.root_dataset["about"] = suborg

    return crate


def main():
    for node in nodes:
        crate = build_crate(node)
        out_dir = OUTPUT_ROOT / node["key"]
        out_dir.mkdir(parents=True, exist_ok=True)
        crate.write(out_dir)
        print(f"Wrote {out_dir / 'ro-crate-metadata.json'}")


if __name__ == "__main__":
    main()