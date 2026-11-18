# The official Caddy runtime is retained (ACME, volume paths and entrypoint).
# The executable is built from official Caddy source at a pinned tag with
# the patched x/net module by tools/build-patched-caddy.sh on GitHub Actions.
FROM caddy:2.11.9-alpine
COPY --chmod=0755 deploy/caddy-patched /usr/bin/caddy
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy && caddy version
LABEL org.opencontainers.image.description="Ventry: Caddy v2.11.9 rebuilt with golang.org/x/net v0.62.0"
