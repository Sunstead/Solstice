# syntax=docker/dockerfile:1.7
#
# solstice-sync, the Solstice Sync server. Build from the repository root:
#   docker build -f apps/sync/Dockerfile -t solstice-sync .
#
# Mirrors Atlas's Dockerfile. Only the server is compiled; the desktop app's
# crate is in the workspace but never built here.

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
ENV SOLSTICE_STATE_DIR=/state \
    SOLSTICE_NOTES_DIR=/notes
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/solstice-sync"]
