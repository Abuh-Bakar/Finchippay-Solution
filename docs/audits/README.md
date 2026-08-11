## Audit Status

| Date | Auditor | Scope | Report | Status |
|------|---------|-------|--------|--------|
| TBD | TBD | Full contract + backend + frontend | *(pending)* | Planned |

### Self-Audit Checklist

We maintain an internal self-audit against our [Security Audit Framework](../SECURITY_AUDIT_FRAMEWORK.md):

- [ ] Smart contract: checked arithmetic, TTL management, authentication, pause mechanism
- [ ] Backend API: rate limiting, input validation, JWT auth, Helmet headers
- [ ] Frontend: CSP headers, encrypted storage, no private key exposure
- [ ] Infrastructure: container scanning (Trivy), dependency auditing, SBOM generation

### Pre-Audit Preparation

Before engaging a third-party auditor:
1. Complete the self-audit checklist above
2. Migrate contract from deprecated `publish()` to `#[contractevent]` macro  
3. Finalize mainnet deployment configuration
4. Verify all SEP implementations comply with latest protocol versions
5. Run full fuzz suite for 24+ hours

> For security inquiries: security@finchippay.dev

