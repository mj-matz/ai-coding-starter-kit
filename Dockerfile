FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg iptables iproute2 && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
        -o /etc/apt/keyrings/tailscale-archive-keyring.gpg && \
    curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
        -o /etc/apt/sources.list.d/tailscale.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends tailscale && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY python/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY python/ /app/

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
