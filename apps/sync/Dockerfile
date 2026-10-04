# syntax=docker/dockerfile:1.7
#
# solstice-sync, the Solstice Sync server, and the web app it serves (the
# desktop app's frontend, built for the browser). Build from the repository
# root:
#   docker build -f apps/sync/Dockerfile -t solstice-sync .
#
# Mirrors Atlas's Dockerfile. Only the server is compiled; the desktop app's
# crate is in the workspace but never built here.

# The web build is platform independent, so it runs natively on the builder.
# git fetches @sunstead/ui, a GitHub dependency pinned to a tag.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/desktop/package.json apps/desktop/
RUN --mount=type=cache,id=solstice-npm,sharing=locked,target=/root/.npm npm ci --no-audit --no-fund
COPY apps/desktop/ apps/desktop/
RUN npm run build -w @solstice/desktop

FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=solstice-sync-registry,sharing=locked,target=/usr/local/cargo/registry \
    --mount=type=cache,id=solstice-sync-target,sharing=locked,target=/src/target \
    cargo build --locked --profile server -p solstice-sync-server \
 && cp /src/target/server/solstice-sync /solstice-sync \
 && mkdir -p /state /notes

# distroless/cc: glibc and libgcc, no shell and no package manager. SQLite is
# compiled in (rusqlite `bundled`) and HTTPS uses rustls with bundled roots.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /solstice-sync /usr/local/bin/solstice-sync
# uid 1000, not distroless's 65532: the notes folder on Jupiter
# (/srv/storage/data/notes) is owned by uid 1000. Docker seeds a new named
# volume with the mount point's ownership, so /state must be owned by it too.
COPY --from=build --chown=1000:1000 /state /state
COPY --from=build --chown=1000:1000 /notes /notes
COPY --from=web /src/apps/desktop/dist /usr/share/solstice/web
ENV SOLSTICE_STATE_DIR=/state \
    SOLSTICE_NOTES_DIR=/notes \
    SOLSTICE_WEB_DIR=/usr/share/solstice/web
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/solstice-sync"]
