# Legacy nginx API gateway (optional)

This **nginx** image mirrored the first strangler edge: route Account paths to
`account-service` and the rest to `apps/api` on the host. The **default** edge
in this repo is now the **Web BFF** ([`../web-bff`](../web-bff)) — a Node
process that encodes the same rules in
[`../web-bff/src/routing.ts`](../web-bff/src/routing.ts) and is what
`docker-compose.microservices.yml` runs on **:3080**.

Use this nginx only if you need a file-based static proxy (e.g. to compare
behaviour) without running the BFF.

```bash
docker build -f services/api-gateway/Dockerfile -t oat-api-gateway .
# Map host :3081 → 80 in the container; point clients at 3081.
```

`nginx.conf` is kept in sync *conceptually* with `web-bff` routing; when
changing one, update the other.
