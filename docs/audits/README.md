# Security Audits

This directory contains published security audit reports for the Finchippay smart contracts and backend infrastructure.

## External Audits

| Date | Auditor | Scope | Report |
|---|---|---|---|
| *Pending* | *TBD* | Full contract + backend | — |

## Internal Audits

Internal audit checklists and findings are tracked in [SECURITY_AUDIT_FRAMEWORK.md](../SECURITY_AUDIT_FRAMEWORK.md).

## Audit History

- **v3.2** (2026-08-08): Comprehensive code quality and security hardening. Hardcoded secrets removed, TypeScript strictness enforced, structured logging deployed.
- **v3.1** (2026-07-26): Soroban SDK v20→v27 upgrade, SBOM generation, storage TTL management.
- **v3.0** (2026-07-14): Initialization guards, batch size enforcement, duplicate signer detection, RBAC pauser role.
- **v2.0**: Initial production-grade Soroban contract.
