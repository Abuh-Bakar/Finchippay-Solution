# Security Policy

## Reporting a Vulnerability

Report security vulnerabilities privately to:
- **Email**: `security@finchippay.dev`
- **PGP Key**: `docs/security/pgp-key.asc` (coming soon)

**Do not open a public issue for security vulnerabilities.**

## Response Timeline

| Severity | Acknowledgment | Patch Release |
|---|---|---|
| **Critical** (direct loss of funds) | 24 hours | 7 days |
| **High** (potential loss, complex exploit) | 48 hours | 14 days |
| **Medium** (service disruption, info leak) | 1 week | 30 days |
| **Low** (minor issues) | 2 weeks | Next release |

## Scope

The following are in scope for vulnerability reports:
- Smart contract (`contracts/finchippay-contract/`)
- Backend API (`backend/src/`)
- Frontend application (`frontend/`)
- SDK (`sdk/`)

## Bug Bounty

We maintain a bug bounty program. Rewards range from $50–$25,000 depending on severity.
Contact `security@finchippay.dev` for details.

## Security Features

- **Smart contract**: Checked arithmetic, TTL management, emergency pause, M-of-N admin
- **Backend**: JWT auth, rate limiting, Helmet headers, SQL injection prevention, input validation
- **Frontend**: CSP headers, encrypted local storage, no private key exposure
- **Infrastructure**: Container scanning (Trivy), dependency auditing, SBOM generation

## Audit History

See [docs/audits/](./docs/audits/) and [docs/SECURITY_AUDIT_FRAMEWORK.md](./docs/SECURITY_AUDIT_FRAMEWORK.md).

## Disclosure Policy

We follow a coordinated disclosure process:
1. Reporter submits vulnerability
2. We acknowledge within published timeline
3. We develop and test a fix
4. We release the fix and publish an advisory
5. We credit the reporter (unless they prefer anonymity)
