# Ventry — hardening and security review (2026-11-18)

## Scope

Reviewed the **static Ventry landing site** as of baseline `0a66a68`. The site has no authenticated API, user accounts, database, uploads, payment endpoints, or server-side rendering. Controls concerning auth, SQL injections, password hashing, payment validation, and upload scanning are therefore **not applicable** to this repository. They must be reconsidered before launching the separate «Расчёт» application.

## Implemented controls

| Area | Change | Evidence |
|---|---|---|
| HTTPS | Existing Caddy ACME, HTTP→HTTPS redirect and 7-day HSTS retained | `.github/workflows/deploy.yml` smoke verification |
| CSP | Added `Content-Security-Policy` with `default-src 'none'`, self-hosted scripts/styles/images/fonts, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'none'` | `tools/verify-security.py` + live Caddy smoke |
| Sensitive URLs | Reject paths with hidden segments (.env, .git, .github) and backup/database/archive/private-key suffixes with HTTP 404 before serving static files | `tests/security-http.sh`, 11 denied paths |
| Supply-chain drift | Pin runtime to release `caddy:2.11.9-alpine` rather than floating `caddy:2-alpine`. Not pinned to an immutable image digest; future automatic replacement of this patch tag is still possible | `compose.yaml` and Caddy validation image |
| Git secrets | PR/main validation checks Git history via Gitleaks v8.30.1 pinned by digest, scans `--all`, redacts any detected values and runs with no network and no persisted checkout token | `.github/workflows/deploy.yml`; failures block deployment |
| Image vulnerabilities | Weekly and on relevant PR/push, Trivy v0.76.2 is pinned by digest and reports fixable HIGH/CRITICAL vulnerabilities for the Caddy release | `.github/workflows/security-audit.yml` (informational report; not a deployment gate) |
| Regression tests | Check for inline JS/CSS violating CSP, correct matched/allowed paths, and execute Caddy HTTP smoke tests | `tools/verify-security.py` and `tests/security-http.sh` |

## Explicit limitations / next actions

1. These tools **do not prove the complete absence of secrets** (custom tokens, external systems or untracked files may not match detection rules). If a scan reports exposure, rotate the credential at its source before discussing history rewriting; never publish token values or raw reports.
2. Blocking sensitive URL patterns protects against accidental exposure, not arbitrary path traversal in the server, unknown suffixes, or credentials stored inside public files.
3. CSP was chosen for the current static design. If integrations, inline scripts, third-party widgets, new CDN assets or forms are introduced, update and test the policy explicitly; do not weaken it with unrestricted `unsafe-inline`.
4. The Trivy job is **report-only** and does not reject a commit containing high-severity findings. Review outcomes and remediate using patched Caddy releases as available, rather than concealing them.
5. Static site is not subject to API rate-limit/auth/payment controls. Upstream network DDoS mitigation and formal external pen-testing are out of scope.
6. The temporary `sslip.io` host and short HSTS are retained intentionally. Do not set HSTS preload/includeSubDomains for an unowned temporary domain.
7. Docker log rotation is covered by separate PR #11 and is **not applied by this hardening patch**.
8. The work does not establish 152-ФЗ legal compliance; the independent privacy/legal audit remains open.
9. A successful Caddy smoke test in CI proves functionality of the tested container and public route rules. The deploy workflow verifies exact assets and headers after deployment, but neither is a browser interaction test across all platforms.

## Run locally (Docker required)

```bash
python3 tools/verify-site.py
python3 tools/verify-security.py
bash tests/security-http.sh
```

Automated runs: `Deploy Ventry` on pull requests/main; `Ventry dependency security audit` on relevant source changes, schedule (Monday 03:20 UTC), and manually.

## References

- Caddy security headers: https://caddyserver.com/docs/caddyfile/directives/header
- Caddy request matchers: https://caddyserver.com/docs/caddyfile/matchers
- Gitleaks official: https://github.com/gitleaks/gitleaks
- Trivy official: https://trivy.dev/docs/latest/ecosystem/cicd/
