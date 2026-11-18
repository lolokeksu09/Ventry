# Ventry — brand/editorial homepage candidate (2026-11-18)

## Scope
- Complete visual redesign of the **company homepage only**.
- Existing Ventry logo, locally hosted Golos Text fonts, brand glass texture and real "Расчёт" ledger photograph remain the source assets.
- References supplied by the owner guide composition, hierarchy and color; no third-party images or templates are copied.
- No changes to the product page, legal/privacy copy, JavaScript behavior, Caddy, Docker, domains or deployment workflows.

## Design decisions
- Hero: large two-line message, readable left copy over existing emerald visual, visible links to projects and company context.
- Identity: deep emerald, warm paper, restrained gold and pale sage details; use existing brand symbol in the header rather than a new invented mark.
- Company: independent editorial section rather than equal-height utility cards.
- Projects: a real, single-feature presentation for "Расчёт"; retain its **В разработке** status and link to the existing details page, without a fake preview app or release date.
- Contact: one clear email action; preserve legal/privacy navigation.

## Review and acceptance
1. Desktop inspect at ~1440×900 and laptop ~1024×768, mobile at ~390×844 and ~320×640.
2. Check header links, keyboard order, focus indicators, low-motion mode, long email wrapping and project links.
3. Verify no horizontal overflow at mobile widths and no text overlaps the hero art.
4. Run existing `python3 tools/verify-site.py`, `node --check site/app.js`, `node tests/copy-link.cjs` and repository CI.
5. Merge only after reviewing the candidate on actual browser sizes. The PR must not be treated as a production deployment.

## Invariants
- `/#about`, `/#projects`, `/#contact`, `/projects/raschet/`, `/legal/`, `/privacy/` stay valid.
- No invented products, commercial terms, metrics, release dates or user testimonials.
- The live production site is unchanged until the branch is merged to `main`.
