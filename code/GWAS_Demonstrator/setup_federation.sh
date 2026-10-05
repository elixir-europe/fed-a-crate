#!/usr/bin/env bash
#
# setup_federation.sh — register this project's SuperLink connection with the
# Flower CLI.
#
# As of Flower 1.26+, SuperLink connection settings live in the user-level
# Flower configuration file (~/.flwr/config.toml), not in the project's
# pyproject.toml. A freshly cloned repository therefore needs its federation
# connection registered once before `flwr run` can submit jobs.
#
# This script adds a `local-deployment` connection pointing at the local
# Docker Compose SuperLink, if one is not already present. Safe to run more
# than once.
# Avoid running this script using sudo, instead make the script executable 
# or manually carry out the config changes.

set -euo pipefail

CONFIG_DIR="${HOME}/.flwr"
CONFIG_FILE="${CONFIG_DIR}/config.toml"
CONNECTION_NAME="local-deployment"

mkdir -p "${CONFIG_DIR}"
touch "${CONFIG_FILE}"

if grep -q "^\[superlink\.${CONNECTION_NAME}\]" "${CONFIG_FILE}"; then
  echo "SuperLink connection '${CONNECTION_NAME}' already present in ${CONFIG_FILE}"
  exit 0
fi

cat >> "${CONFIG_FILE}" << 'TOML'

# PRS federation — local Docker Compose deployment.
# Added by setup_federation.sh. Matches the SuperLink control API port
# exposed in compose.yml (9093).
[superlink.local-deployment]
address  = "127.0.0.1:9093"
insecure = true
TOML

echo "Added SuperLink connection '${CONNECTION_NAME}' to ${CONFIG_FILE}"
echo
echo "You can verify it with:  flwr config list"
