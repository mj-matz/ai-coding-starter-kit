#!/bin/sh
set -e

# Tailscale userspace daemon. Listens on localhost:1055 for both SOCKS5 and
# HTTP-CONNECT proxying — application code reaches tailnet peers by routing
# httpx through this proxy.
mkdir -p /tmp/tailscale
/usr/sbin/tailscaled \
    --tun=userspace-networking \
    --socks5-server=localhost:1055 \
    --outbound-http-proxy-listen=localhost:1055 \
    --statedir=/tmp/tailscale &
TAILSCALED_PID=$!

# Wait for the local API socket before calling `tailscale up`.
for i in 1 2 3 4 5 6 7 8 9 10; do
    if tailscale status --peers=false >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

if [ -z "${TS_AUTHKEY:-}" ]; then
    echo "FATAL: TS_AUTHKEY is not set. Add it as a Railway env var." >&2
    kill $TAILSCALED_PID 2>/dev/null || true
    exit 1
fi

tailscale up \
    --authkey="${TS_AUTHKEY}" \
    --hostname="${TS_HOSTNAME:-railway-mt5-backend}" \
    --accept-routes \
    --accept-dns=true

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
