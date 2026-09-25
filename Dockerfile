# Multi-stage build: FE is built by Node, then only its static output (FE/dist)
# is copied into the Python image that actually runs in production. This
# mirrors how the app already runs — one FastAPI process serving both the API
# and the built console on one port (see FE_DIST in Backend/main.py) — so
# Docker doesn't change the architecture, it just makes the two-step build
# (npm run build, then restart the backend) into one `docker build`.

# ── stage 1: build the React console ────────────────────────────────────────
FROM node:20-slim AS fe-build
WORKDIR /app/FE
COPY FE/package.json FE/package-lock.json ./
RUN npm ci
COPY FE/ ./
RUN node node_modules/vite/bin/vite.js build

# ── stage 2: the backend, with the built console alongside it ──────────────
# Pinned to a container-local Python, independent of whatever the host has —
# sidesteps the "server runs Python 3.14, some wheels lag behind" gotcha
# noted in docs/DEPLOY-NEW-APP-ON-THIS-SERVER.md.
FROM python:3.12-slim AS backend
WORKDIR /app/Backend

COPY Backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY Backend/ ./
# main.py reads FE_DIST as BASE_DIR.parent / "FE" / "dist", i.e. /app/FE/dist
# relative to this WORKDIR — same layout as the source checkout.
COPY --from=fe-build /app/FE/dist /app/FE/dist

# poc.db and uploads/ are runtime state, not image content — bind-mounted in
# via docker-compose.yml so a rebuild/redeploy never touches them.
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
