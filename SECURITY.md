# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| `main`  | ✅ Active support  |
| Older releases | ❌ Not supported |

We recommend always running the latest release. Critical security fixes are applied to `main` first and then tagged as a new release.

---

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues by emailing **security@finchippay.io** (PGP key available on [keys.openpgp.org](https://keys.openpgp.org)).

Include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept code or a detailed write-up).
- Any relevant environment details (Node version, OS, contract version, etc.).

### What to expect

| Timeline | Action |
|----------|--------|
| **≤ 2 business days** | Acknowledgement of your report |
| **≤ 7 days** | Initial severity assessment and triage |
| **≤ 30 days** | Fix developed and tested (complex issues may take longer) |
| **≤ 45 days** | Coordinated public disclosure |

We follow responsible disclosure. We will credit researchers in our release notes unless you prefer to remain anonymous.

---

## Software Bill of Materials (SBOM)

### What is an SBOM?

A Software Bill of Materials (SBOM) is a machine-readable inventory of all software components, libraries, and their transitive dependencies included in a release. SBOMs help organisations assess supply-chain risk and comply with regulations such as [US Executive Order 14028](https://www.nist.gov/system/files/documents/2021/11/08/software-supply-chain-security-eo14028.pdf).

### Available SBOMs

SBOMs are generated for **every release** and attached as assets to the [GitHub Releases](https://github.com/FinChippay/Finchippay-Solution/releases) page.

| Component | Format | Description |
|-----------|--------|-------------|
| `sbom-frontend-cdx.json` | CycloneDX JSON | Next.js frontend and all npm dependencies |
| `sbom-frontend-spdx.json` | SPDX JSON | Next.js frontend and all npm dependencies |
| `sbom-backend-cdx.json` | CycloneDX JSON | Express backend and all npm dependencies |
| `sbom-backend-spdx.json` | SPDX JSON | Express backend and all npm dependencies |
| `sbom-contract-cdx.json` | CycloneDX JSON | Soroban Rust contract and all cargo dependencies |
| `sbom-contract-spdx.json` | SPDX JSON | Soroban Rust contract and all cargo dependencies |

### How SBOMs are generated

SBOMs are produced automatically by [Syft](https://github.com/anchore/syft) (via the `anchore/sbom-action` GitHub Action) on:

- **Every push to `main` / `develop`** — SBOMs are uploaded as workflow run artifacts (retained for 90 days).
- **Every pull request** — SBOMs are scanned for vulnerabilities as part of CI.
- **Every release tag** — SBOMs are attached to the GitHub Release as downloadable assets (retained indefinitely).
- **Weekly (Sunday 02:00 UTC)** — Scheduled drift detection scan; new critical vulnerabilities automatically open a GitHub issue.

### Requesting an SBOM

- **Latest release**: download the SBOM files from the [Releases](https://github.com/FinChippay/Finchippay-Solution/releases) page.
- **Specific build SHA**: download the `sbom-bundle-<sha>` artifact from the [Actions](https://github.com/FinChippay/Finchippay-Solution/actions) page.
- **Custom request**: email **security@finchippay.io** with the release version or commit SHA you need.

### Scanning SBOMs for vulnerabilities

You can scan a downloaded SBOM locally using [Grype](https://github.com/anchore/grype):

```bash
# Install Grype
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin

# Scan a CycloneDX SBOM
grype sbom:sbom-frontend-cdx.json

# Fail on critical vulnerabilities only
grype sbom:sbom-backend-cdx.json --fail-on critical
```

Or scan a container image directly using [Trivy](https://github.com/aquasecurity/trivy):

```bash
trivy image ghcr.io/finchippay/finchippay-backend:latest --severity CRITICAL,HIGH
```

### Generating SBOMs locally

The `make sbom` target produces SBOMs for all components into the `sbom/` directory:

```bash
# Install Syft first
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Generate all SBOMs
make sbom
```

---

## CI Vulnerability Scanning

The following automated scans run on every PR and push:

| Scan | Tool | Gate |
|------|------|------|
| npm dependency audit (frontend) | `npm audit` | Fails on **high** |
| npm dependency audit (backend) | `npm audit` | Fails on **high** |
| cargo dependency audit (contracts) | `cargo audit` | Fails on **high** |
| SBOM vulnerability scan (all components) | Grype | Fails on **critical** |
| Container image scan (backend) | Trivy | Fails on **critical** |
| Container image scan (frontend) | Trivy | Fails on **critical** |
| Static analysis | CodeQL | Fails on **high** |

Container images are scanned **before** being pushed to the registry, so no vulnerable image is ever published.

---

## Security Architecture

Key security properties of the Finchippay platform:

- **Non-custodial**: private keys never leave the user's browser — all signing happens inside Freighter.
- **On-chain auth**: every contract entry-point calls `require_auth()` before mutating state.
- **Secret redaction**: Stellar secret keys are automatically redacted from all log output and Sentry events.
- **Rate limiting**: 100 req/15 min globally; 20 req/min on sensitive routes; 10 req/min on account lookup.
- **Strict CSP**: Helmet enforces Content Security Policy; all responses include `X-Content-Type-Options: nosniff`.
- **Input sanitisation**: all user-supplied fields are stripped of HTML/script injection.
- **HMAC-SHA256 webhooks**: payloads are signed and verified before processing.
- **Circuit breaker**: admin `pause()` can freeze all value-transferring contract operations.
- **Checked arithmetic**: all Soroban maths uses `checked_add`/`checked_sub`/`checked_mul` — overflows panic rather than wrap silently.
