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
Browser screenshot and interactive visual checks were attempted locally, but the environment returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for local file/localhost in Chromium. Visual QA on real phone and desktop remains necessary **before merging**.

## Acceptance
- [ ] CI `verify-site`, security, Compose and Caddy tests pass.
- [ ] Header stays one row at 320, 390 and 430 px.
- [ ] No horizontal scroll, clipped text or overlap at 320, 390, 768, 1024 and 1440 px.
- [ ] Product image loads and remains properly cropped in both layout modes.
- [ ] Keyboard focus and all links remain functional; reduced motion respected.
- [ ] Confirm with owner before merging: this is a proposed alternative, not an approved production design.

## Invariants
Preserve logo files, `/#about`, `/#projects`, `/#contact`, `/projects/raschet/`, `/legal/`, `/privacy/`, existing mail address and deploy workflow.
