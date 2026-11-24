# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**XTBCelebrated** — a closed, English-only Shopify store (Grow plan) where XTB employees redeem a single-use gift card ("voucher") for merch. Built by us as subcontractor for MerchUp. The repo is Shopify's **Horizon** theme (cloned from `https://github.com/Shopify/horizon.git`, git `origin` still points there) customised for this store.

- `xtb-brief.pdf` — client brief (source of truth for requirements).
- `PLAN.md` — build plan: blockers/workarounds (B1–B14), inputs checklist, phases, verification steps. Read it before store or theme work.

Most of the project is **store configuration + apps** (Shopify Flow, Locksmith, bulk gift card app, Shopify Payments), not theme code. Theme work is a reskin.

### Confirmed decisions (override the brief where they differ)
- Carts may exceed the voucher value; employee pays the difference via Shopify Payments (client sign-off pending).
- XTB distributes voucher codes from a CSV export; gift cards are not assigned to customers.
- No tax or duties collected at checkout. Free shipping everywhere.
- Prices shown as **"XTB Coins"** (1 coin = 1 USD) via the store money format `{{amount_no_decimals}} XTB Coins`; checkout still shows `$`.

### Branding
Red background `#C20100`, cream text `#FEF7E0`, black pill accent `#070809`; playful hand-drawn accents (see card image in the brief). Footer on every page: "This store is operated by MerchUp" with MerchUp linking to https://www.merchup.com in a new tab.

## Rules

### Commits
- Use semantic (Conventional Commit) prefixes: `feat:`, `fix:`, `hotfix:`, `chore:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `revert:`. Optional scope: `feat(footer): add MerchUp link`. Imperative, lowercase subject, no trailing period.
- **No AI references in commits or PRs**: no `Co-Authored-By` trailers, no "Generated with Claude Code" lines, no mention of AI/Claude in messages or branch names.
- Author identity: `devmarlou <dev.marlou@gmail.com>` (set in the repo-local git config).

### Code
- Keep code clean and minimal; prefer extending Horizon's existing blocks/snippets over new ones.
- When markup or logic repeats (e.g. the "we are xtb" pill, sparkle accents, branded CTA), extract it into a reusable snippet (`snippets/`, documented with a `{% doc %}` block and `@param`s like existing snippets) or a theme block (`blocks/`) — only when it is actually reused or editor-configurable.
- Don't hardcode brand values in multiple places; use theme settings / CSS custom properties.

## Commands

Store: `xtbcelebrated-pmfbmesf.myshopify.com` (partner dev store). Work theme: **XTBCelebrated (dev)**, id `202478485848` (unpublished). Never push to the live theme. The Shopify MCP connector is read-only (no mutations, gift card writes blocked); store settings are changed by the user in the admin.

No build step, no package manager, no test suite — files are served as-is by Shopify. Requires [Shopify CLI](https://shopify.dev/docs/storefronts/themes/tools/cli).

```sh
shopify theme dev --store <store>.myshopify.com   # local preview with hot reload
shopify theme check                               # lint (Theme Check)
shopify theme push --unpublished --store <store>  # push as a new unpublished theme
shopify theme pull --only config/settings_data.json --only templates/*.json  # pull editor changes back
```

JS is type-checked in-editor via `assets/jsconfig.json` (`checkJs`, strict null checks); there is no CLI typecheck script.

Pull upstream Horizon updates: `git remote add upstream https://github.com/Shopify/horizon.git && git pull upstream main` (expect conflicts in customised files).

## Theme architecture (Horizon)

- **Server-rendered first.** Business logic, translations and money formatting belong in Liquid, not JS. Client JS is progressive enhancement.
- **Theme blocks.** `blocks/` holds reusable blocks nestable inside any section; files prefixed `_` are private blocks only usable by their parent section/block. Generic sections (`sections/section.liquid`, `_blocks.liquid`) render arbitrary blocks, so most layout is composed in JSON templates (`templates/*.json`, `sections/header-group.json`, `sections/footer-group.json`) rather than in Liquid.
- **JSON templates and `config/settings_data.json` are rewritten by the theme editor.** Edits made there in the admin will overwrite local edits — pull before changing them.
- **Colours** use a global palette (`settings.color_palette`, `palette_*` button settings in `config/settings_schema.json` → output as CSS custom properties by `snippets/color-palette.liquid`), not per-section colour schemes. Fonts are settings (`type_*_font`); self-hosted fonts would go in `assets/` with `@font-face`.
- **JS = native ES modules, no bundler.** Modules are mapped via the import map in `snippets/scripts.liquid` (`@theme/<name>` → `assets/<name>.js`); add new modules there. Custom elements extend `Component` (`assets/component.js`), which wires `ref="name"` children into `this.refs` and declarative listeners like `on:click="/method"` or `on:click="#element-id/method"`.
- **Money in JS**: `assets/money-formatting.js` replicates the Liquid `money` filter using `shop.money_format`, so the "XTB Coins" format applies to client-rendered prices without patching.
- **Storefront copy** (e.g. "Taxes and shipping calculated at checkout") lives in `locales/en.default.json`; schema/editor labels are in `locales/*.schema.json`.
- Relevant spots for this project: `blocks/accelerated-checkout.liquid` (Shop Pay / dynamic checkout buttons — remove), `templates/gift_card.liquid` + `assets/template-giftcard.css` (voucher page), `sections/footer*.liquid` (MerchUp footer), `layout/theme.liquid` (global head/body).
