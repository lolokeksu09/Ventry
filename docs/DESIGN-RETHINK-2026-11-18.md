# Review: Ventry brand-first homepage (2026-11-18)

## Trigger
The owner rejected the deployed previous design as generic. Mobile screenshot at roughly 390 CSS pixels shows a tall abstract image, two-row navigation, a generic slogan, a square inset logo, and the project not visible until after a long scroll.

## Design rationale
- Treat **Ventry** as the central brand rather than an interchangeable SaaS slogan.
- Use only the existing Ventry mark geometry (from `site/favicon.svg`) as an oversized vector identity in an emerald panel. The brand asset in the header is unchanged.
- Return the hero to light editorial negative space. Avoid generic gradients, glass textures, badges, metrics, fake dashboards and decorative cards.
- Show a distinct and truthful `Расчёт` case study using existing project images, exact route and the existing 'В разработке' status.
- Use the locally hosted Golos Text; no new dependencies, fonts, scripts or extra images.
- Keep company, project and contact links; no changes to product/legal pages or infrastructure.

## Known limits
Static checks of linked routes, source content and CSS braces were performed; those do **not** establish appearance.
Local Chromium access was blocked (`net::ERR_BLOCKED_BY_ADMINISTRATOR`), so the separate `Ventry visual preview` GitHub Actions job renders the exact PR files in real Chrome. Run [44280347500](https://github.com/lolokeksu09/Ventry/actions/runs/44280347500) completed successfully with screenshots for 320px, 390px and 1440px. Browser metrics: mobile `scrollWidth === viewport` at both widths; header height 66px; hero heights 657px and 610px respectively; logo and product image decoded. Desktop at 1440px: `scrollWidth=1425`, both images decoded. Visual inspection confirmed the product photo renders on desktop after decoding the lazy asset. Real-device QA and owner approval remain necessary before merge.

## Acceptance
- [ ] Main CI `verify-site`, security, Compose and Caddy tests: final latest-commit status pending.
- [x] Header stays one row at 320px and 390px in Chrome; 430px remains untested.
- [x] No horizontal page scroll at 320px, 390px and 1440px in Chrome; 768px and 1024px remain untested.
- [x] Product image decoded and visibly rendered at 390px and 1440px.
- [ ] Keyboard focus, every link and reduced motion have not been checked interactively.
- [ ] Confirm with owner before merging: this is a proposed alternative, not an approved production design.

## Invariants
Preserve logo files, `/#about`, `/#projects`, `/#contact`, `/projects/raschet/`, `/legal/`, `/privacy/`, existing mail address and deploy workflow.
