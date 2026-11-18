# Ventry — hardening and security review (2026-11-18)

## Scope

Reviewed the **static Ventry landing site** as of baseline `0a66a68`. The site has no authenticated API, user accounts, database, uploads, payment endpoints, or server-side rendering. Controls concerning auth, SQL injections, password hashing, payment validation, and upload scanning are therefore **not applicable** to this repository. They must be reconsidered before launching the separate «Расчёт» application.

## Implemented controls

| Area | Change | Evidence |
|---|---|---|
| HTTPS | Existing Caddy ACME, HTTP→HTTPS redirect and 7-day HSTS retained | `.github/workflows/deploy.yml` smoke verification |
| CSP | Added `Content-Security-Policy` with `default-src 'none'`, self-hosted scripts/styles/images/fonts, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'none'` | `tools/verify-security.py` + live Caddy smoke |
| Sensitive URLs | Reject paths with hidden segments (.env, .git, .github) and backup/database/archive/private-key suffixes with HTTP 404 before serving static files | `tests/security-http.sh`, 11 denied paths |
| Supply-chain drift | Retain official `caddy:2.11.9-alpine` base image, **replace vulnerable Caddy binary** with build from official Caddy `v2.11.9` Go module and `golang.org/x/net v0.62.0` using Go 1.27.4 | `tools/build-patched-caddy.sh`, `deploy/Dockerfile`, `compose.yaml` |
| Git secrets | PR/main validation checks Git history via Gitleaks v8.30.1 pinned by digest, scans `--all`, redacts any detected values and runs with no network and no persisted checkout token | `.github/workflows/deploy.yml`; failures block deployment |
| Image vulnerabilities | Weekly and on relevant PR/push, Trivy scans the **built patched image**, failing on fixable HIGH/CRITICAL findings (`--exit-code 1 --ignore-unfixed`); release smoke validates patched Caddy | `.github/workflows/security-audit.yml`, runs #6 and #7: 0 HIGH/CRITICAL |
| Regression tests | Check for inline JS/CSS violating CSP, correct matched/allowed paths, and execute Caddy HTTP smoke tests | `tools/verify-security.py` and `tests/security-http.sh` |

## CI results and remediation of CVE-2026-78661

At PR #16 revision `9a6069e`, **Deploy Ventry / validate** completed successfully (run #39): Gitleaks reported **`no leaks found`** for the history reachable in checkout, static source verification passed for 4 HTML pages, and the container HTTP test passed 11 denied routes and 8 legitimate routes.

The **Trivy image audit** (run #1, 2026-11-18) completed with this result for `caddy:2.11.9-alpine`:

| Component | HIGH | CRITICAL |
|---|---:|---:|
| Alpine 3.24.4 OS packages | 0 | 0 |
| Caddy Go binary | 1 | 0 |

- **HIGH CVE-2026-78661**: `golang.org/x/net/html` denial of service via crafted HTML input; detected `golang.org/x/net v0.60.0`, fixed upstream in `v0.62.0`.
- Caddy `2.11.9` is the latest publicly identified official stable release for the audit date. No patched **official Caddy container release** was verified as available.
- The site uses Caddy primarily as a static file server; a reachable call into the affected HTML parser was **not demonstrated**, but inclusion of the affected library is verified and must not be presented as zero vulnerabilities.
- **Disposition: RESOLVED IN VENTRY'S DEPLOYED RUNTIME** at commit `da5a36fc55a4478989aef6963c52fb7f05398eeb`. The official Caddy 2.11.9 source is rebuilt with `golang.org/x/net v0.62.0` using Go 1.27.4; GitHub Actions confirms the version embedded in the binary and replaces `/usr/bin/caddy` in the runtime container. This is a Ventry-maintained source rebuild, **not an officially patched Caddy release**.
- **Retest passed:** Trivy run #6 (PR) and run #7 (main) found **0 HIGH and 0 CRITICAL** in the final patched image (`Alpine: 0; Go binary: 0`); scanner now uses `--exit-code 1` and fails if it finds fixable HIGH/CRITICAL vulnerabilities. It still uses `--ignore-unfixed`, so it is not a comprehensive all-severities/all-findings attestation.
- Note: although the container image reference in the workflow is labelled `0.76.2`, the pinned digest printed scanner runtime **0.76.1**. The image digest, not the tag portion, determines the executed artifact; align this with a verified `0.76.2` manifest in a follow-up supply-chain maintenance change.

Sources: the original Trivy run #1, the patched-image scan runs [#6](https://github.com/lolokeksu09/Ventry/actions/runs/44255798972) and [#7](https://github.com/lolokeksu09/Ventry/actions/runs/44256270666), and the production [Deploy Ventry #45](https://github.com/lolokeksu09/Ventry/actions/runs/44256270618). The production deployment log confirms `COPY deploy/caddy-patched /usr/bin/caddy`, successful local image build `ventry-web`, container recreation/start, `VENTRY_DEPLOY_OK`, exact asset comparison and HTTPS checks.

**Runtime verification:** GitHub Actions examines `go version -m` of the built binary for `golang.org/x/net v0.62.0`, and the deployment uses that same binary via artifacts. Direct `docker exec` inspection of the live VDS container was not conducted, but the server's image build/replace steps and health/HTTPS smoke succeeded.

**Roll-forward rule:** on a new official patched Caddy release, prefer switching back to a verified upstream image with clean Trivy results rather than maintaining this source rebuild forever.

Historical original finding: https://pkg.go.dev/vuln/GO-2026-6860 .

## Explicit limitations / next actions

1. These tools **do not prove the complete absence of secrets** (custom tokens, external systems or untracked files may not match detection rules). If a scan reports exposure, rotate the credential at its source before discussing history rewriting; never publish token values or raw reports.
2. Blocking sensitive URL patterns protects against accidental exposure, not arbitrary path traversal in the server, unknown suffixes, or credentials stored inside public files.
3. CSP was chosen for the current static design. If integrations, inline scripts, third-party widgets, new CDN assets or forms are introduced, update and test the policy explicitly; do not weaken it with unrestricted `unsafe-inline`.
4. Trivy now **fails** for detected fixable HIGH/CRITICAL vulnerabilities, but is a separate workflow rather than a hard dependency of the deploy job; require its green status in release review and monitor weekly results. The Caddy source rebuild must be audited when upstream releases change.
5. Static site is not subject to API rate-limit/auth/payment controls. Upstream network DDoS mitigation and formal external pen-testing are out of scope.
6. The temporary `sslip.io` host and short HSTS are retained intentionally. Do not set HSTS preload/includeSubDomains for an unowned temporary domain.
7. Docker log rotation is covered by separate PR #11 and is **not applied by this hardening patch**.
8. The work does not establish 152-ФЗ legal compliance; the independent privacy/legal audit remains open.
9. A successful Caddy smoke test in CI proves functionality of the tested container and public route rules. The deploy workflow verifies exact assets and headers after deployment, but neither is a browser interaction test across all platforms.

## Run locally (Docker required)

```bash
python3 tools/verify-site.py
python3 tools/verify-security.py
bash tools/build-patched-caddy.sh
docker build -t ventry-caddy:patched-test -f deploy/Dockerfile .
VENTRY_CADDY_IMAGE=ventry-caddy:patched-test bash tests/security-http.sh
```

Automated runs: `Deploy Ventry` on pull requests/main; `Ventry dependency security audit` on relevant source changes, schedule (Monday 03:20 UTC), and manually.

## References

- Caddy security headers: https://caddyserver.com/docs/caddyfile/directives/header
- Caddy request matchers: https://caddyserver.com/docs/caddyfile/matchers
- Gitleaks official: https://github.com/gitleaks/gitleaks
- Trivy official: https://trivy.dev/docs/latest/ecosystem/cicd/
