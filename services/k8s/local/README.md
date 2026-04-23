# Local Kubernetes (kind / k3d / minikube)

These manifests are a **minimal dev example** for the Account microservice. They assume:

- A cluster is already running (`kind create cluster`, `k3d cluster create`, or minikube start).
- **Postgres** for the global DB is reachable from the cluster. Easiest options:
  - **Docker Desktop:** use `host.docker.internal` as `GLOBAL_DATABASE_URL` host from inside kind (see deployment env).
  - **Compose:** run `global-pg` on the host and port-forward `5432`, or attach kind to the same Docker network (advanced).

## Apply

```bash
kubectl apply -k services/k8s/local
```

## Load image (kind)

```bash
docker build -f services/account-service/Dockerfile -t oat-account-service:local .
kind load docker-image oat-account-service:local --name kind
```

Then set `imagePullPolicy: Never` (already set in the example deployment) or push to a registry.

## Port-forward

```bash
kubectl -n oat-dev port-forward svc/account-service 3010:3010
curl -s http://localhost:3010/health
```

## Production

Use Helm/Kustomize per environment, external secrets for `JWT_SECRET` and DB URLs, and a real ingress — not this bare Deployment.
