# Deployment Guide

Finchippay Solution supports multiple deployment strategies:

## Quick Deploy (Vercel + Docker)

### Frontend (Vercel)

```bash
vercel --prod
```

### Backend (Docker)

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Production Deployment (Terraform + Kubernetes)

### Prerequisites

- DigitalOcean account
- Terraform CLI 1.5+
- kubectl
- Docker

### Infrastructure (Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your DO token and settings
terraform init
terraform plan
terraform apply
```

### Application (Kubernetes)

```bash
kubectl apply -f kubernetes/nginx/
kubectl apply -f kubernetes/backend/
kubectl apply -f kubernetes/frontend/
```

## Environment Variables

See [ENV.md](./ENV.md) for required environment variables.

## Monitoring

- **Grafana**: Import dashboards from `docs/grafana-*.json`
- **Prometheus**: Alert rules in `docs/prometheus-alerts.yml`
- **Sentry**: Error tracking configured via `SENTRY_DSN`
