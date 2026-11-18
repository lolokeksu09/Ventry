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

## CI results and outstanding dependency finding

At PR #16 revision `9a6069e`, **Deploy Ventry / validate** completed successfully (run #39): Gitleaks reported **`no leaks found`** for the history reachable in checkout, static source verification passed for 4 HTML pages, and the container HTTP test passed 11 denied routes and 8 legitimate routes.

The **Trivy image audit** (run #1, 2026-11-18) completed with this result for `caddy:2.11.9-alpine`:

| Component | HIGH | CRITICAL |
|---|---:|---:|
| Alpine 3.24.4 OS packages | 0 | 0 |
| Caddy Go binary | 1 | 0 |

- **HIGH CVE-2026-78661**: `golang.org/x/net/html` denial of service via crafted HTML input; detected `golang.org/x/net v0.60.0`, fixed upstream in `v0.62.0`.
- Caddy `2.11.9` is the latest publicly identified official stable release for the audit date. No patched **official Caddy container release** was verified as available.
- The site uses Caddy primarily as a static file server; a reachable call into the affected HTML parser was **not demonstrated**, but inclusion of the affected library is verified and must not be presented as zero vulnerabilities.
- **Disposition: OPEN.** Track official Caddy release that includes `x/net >= 0.62.0`; update image and rerun Trivy + integration smoke tests before marking resolved. Avoid riskier unreviewed custom server builds solely to suppress scanner findings.
- Trivy workflow is **report-only** (`--exit-code 0`). A green workflow means the scanner completed, **not that there were no vulnerabilities**.
- Note: although the container image reference in the workflow is labelled `0.76.2`, the pinned digest printed scanner runtime **0.76.1**. The image digest, not the tag portion, determines the executed artifact; align this with a verified `0.76.2` manifest in a follow-up supply-chain maintenance change.

Sources: scan output from GitHub Actions run #1 and Go advisory CVE-2026-78661; vulnerability source https://pkg.go.dev/vuln/GO-2026-6860 .

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
