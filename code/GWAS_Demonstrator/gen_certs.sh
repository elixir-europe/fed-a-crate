#!/usr/bin/env bash
# gen_certs.sh
# ─────────────────────────────────────────────────────────────────────────
# Generates a self-signed CA + server cert + key for testing TLS between
# the central server and the node clients.
#
# For real deployments across actual nodes you'd use certs issued by your
# institution's CA instead of self-signed ones.
#
# Usage:
#     bash gen_certs.sh
#     # then in docker-compose.yml, uncomment the CERTS_DIR env var and
#     # the ./certs volume mount on fed-server, AND set CERTS_DIR=/certs
#     # on each node1/2/3 service plus mount ./certs:/certs:ro there too.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

CERT_DIR="${1:-./certs}"
SERVER_HOST="${SERVER_HOST:-fed-server}"
DAYS=365

mkdir -p "${CERT_DIR}"
cd "${CERT_DIR}"

echo "Generating self-signed CA …"
openssl req -x509 -nodes -newkey rsa:4096 \
    -keyout ca.key -out ca.crt -days "${DAYS}" \
    -subj "/CN=PRS-Federation-CA" >/dev/null 2>&1

echo "Generating server key + CSR …"
openssl req -nodes -newkey rsa:4096 \
    -keyout server.key -out server.csr \
    -subj "/CN=${SERVER_HOST}" >/dev/null 2>&1

# SAN extension so 'fed-server' DNS name + localhost work
cat > server-ext.cnf <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${SERVER_HOST}
DNS.2 = localhost
IP.1  = 127.0.0.1
EOF

echo "Signing server cert with CA …"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days "${DAYS}" -sha256 -extfile server-ext.cnf >/dev/null 2>&1

# Tidy up intermediate artefacts
rm -f server.csr server-ext.cnf ca.srl

echo
echo "✓ Certificates generated in ${CERT_DIR}:"
echo "    ca.crt       (root cert — shared with clients)"
echo "    server.crt   (server cert — used by fed-server)"
echo "    server.key   (server private key — used by fed-server)"
echo "    ca.key       (root CA private key — keep secret!)"
echo
echo "Next steps:"
echo "  1. Uncomment the CERTS_DIR env var and ./certs volume mount on"
echo "     fed-server in docker-compose.yml"
echo "  2. Add the same CERTS_DIR=/certs env var and"
echo "     ./certs:/certs:ro mount to each node1/2/3 service"
echo "  3. docker compose up --build"
