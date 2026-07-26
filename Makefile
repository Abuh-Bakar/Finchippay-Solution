# Makefile — Common development commands for Finchippay Solution
#
# Usage:
#   make dev     — start frontend + backend concurrently (hot-reload)
#   make test    — run all tests (frontend unit + backend unit)
#   make lint    — lint frontend + backend
#   make build   — build Docker images (dev compose)

.PHONY: dev test lint build storybook sbom

dev:
	npm run dev

test:
	npm run test --prefix frontend
	npm run test --prefix backend

lint:
	npm run lint --prefix frontend
	npm run lint --prefix backend

build:
	docker compose build

storybook:
	npm run storybook --prefix frontend

# ─── SBOM Generation ──────────────────────────────────────────────────────────
# Generates CycloneDX SBOMs for all components into sbom/
# Prerequisites: Syft must be installed (https://github.com/anchore/syft)
#   curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
sbom:
	@echo "📦 Generating SBOMs for all components..."
	@mkdir -p sbom

	@echo "  → frontend (CycloneDX JSON)"
	syft dir:frontend --output cyclonedx-json=sbom/frontend.cdx.json

	@echo "  → frontend (SPDX JSON)"
	syft dir:frontend --output spdx-json=sbom/frontend.spdx.json

	@echo "  → backend (CycloneDX JSON)"
	syft dir:backend --output cyclonedx-json=sbom/backend.cdx.json

	@echo "  → backend (SPDX JSON)"
	syft dir:backend --output spdx-json=sbom/backend.spdx.json

	@echo "  → contracts (CycloneDX JSON)"
	syft dir:contracts/finchippay-contract --output cyclonedx-json=sbom/contract.cdx.json

	@echo "  → contracts (SPDX JSON)"
	syft dir:contracts/finchippay-contract --output spdx-json=sbom/contract.spdx.json

	@echo "✅ SBOMs written to sbom/"
