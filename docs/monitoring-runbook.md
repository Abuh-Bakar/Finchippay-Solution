# Monitoring Runbook

## Dashboard Quick Reference

| Dashboard | File | Purpose |
|---|---|---|
| System | `grafana-system.json` | CPU, memory, disk, network |
| Operations | `grafana-operations.json` | API latency, error rates, DB pool |
| Business | `grafana-business.json` | Transaction volume, user signups |
| Stellar | `grafana-dashboard.json` | Horizon health, fee levels |

## Key Alerts (prometheus-alerts.yml)

| Alert | Severity | Respond |
|---|---|---|
| `HighErrorRate` | Critical | Check Sentry + logs |
| `ContractMinTTL` | Warning | Call `bump_all_ttls` |
| `HorizonUnreachable` | Critical | Check Stellar network status |
| `DBConnectionPoolExhausted` | Critical | Scale DB or check queries |
| `RedisUnavailable` | Warning | Cache degraded; app still works |

## Incident Response

1. **Detect** — Alert fires or user reports
2. **Triage** — Check Grafana + Sentry
3. **Contain** — Pause contract if needed
4. **Resolve** — Fix + deploy
5. **Post-mortem** — Document in `docs/incidents/`
