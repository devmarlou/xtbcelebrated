# XTBCelebrated – Build Plan, Needs, Blockers & Workarounds

## Context
XTB (via MerchUp) wants a closed, English-only Shopify store (Grow plan) where employees redeem a single-use anniversary gift card for merch (≤10 products). It is mostly store configuration plus a Horizon theme reskin plus a few apps, not custom development. The riskiest parts are **gift cards/currency**, **access gating**, and **checkout limits on the Grow plan**. This plan lists what we need, the blockers, and the workaround for each, then the build order.

Decisions confirmed with you (2026-11-25):
- Carts **can go over** the voucher value, and the **employee pays the difference**. ⚠ The brief says "employee never pays", so XTB/MerchUp must sign off on this change.
- **XTB distributes codes** from our CSV export. No employee list is needed, and cards are not assigned to customers.
- **No tax and no duties at checkout.** MerchUp handles VAT on its invoice to XTB; their accountant should confirm.

---

## 1. Blockers & workarounds (the core of this plan)

| # | Area | Blocker / risk | Workaround / decision |
|---|------|----------------|-----------------------|
| B1 | Single-use gift card | Shopify gift cards keep their remaining balance, and Flow has **no native "deactivate gift card" action**. Flow can't easily tell which gift card an order used. | Flow trigger **Order created** → condition: a transaction with `gateway = gift_card` → **Send Admin API request** `giftCardDeactivate(id)`. The gift card ID comes from the transaction `receiptJson` (`gift_card_id`). **Spike first.** Fallback A: a small custom app or webhook (`orders/create` → `giftCardDeactivate`). Fallback B: a bulk gift card app that has a built-in "single-use / zero out after order" feature. |
| B2 | Race window | Flow runs a few seconds after the order. Two checkouts opened at the same moment could both spend the remaining balance. | Accept the risk (very low). Document it. Flow also tags the order `voucher-used` for audit. |
| B3 | Refunds/cancellations | A refund back to a gift card that is now deactivated means the employee loses the value. | Support process: refund to the original method (if they paid part) and **issue a new voucher**. Add this to the training doc. |
| B4 | Bulk codes + full-code export | The Shopify admin can't bulk-create gift cards, and its CSV export only shows the **last 4 characters**. | Use a bulk gift card app (BatchCard, Datora; also consider **Matrixify**, which imports gift cards with custom codes and an expiry date). Compare cost. Fallback: our own codes through Admin API `giftCardCreate` (code + `expiresOn`) with a CSV script. Use one batch per value per issue date, with `expiresOn` = issue date + 1 year. |
| B5 | "XTB Coins" currency | Money-format relabelling changes Liquid output only. **Checkout, Shopify-hosted customer account pages, Shop Pay buttons and any JS `Intl` formatting still show `$`.** | Set store currency to USD. Set all 4 money formats (HTML/email, with/without currency) to `{{amount_no_decimals}} XTB Coins`. Audit Horizon JS for client-side currency formatting and patch it. Hide dynamic checkout / Shop Pay buttons on the storefront. The "How to order" page explains **1 XTB Coin = $1**. Checkout UI extensions are Plus-only, so we can't add a note inside checkout. Accept `$` there. |
| B6 | Markets / local currency | Turning on Shopify Payments can auto-enable local currencies. A German employee would then see EUR, which breaks the Coins = USD mapping. | Create one market covering all countries, **USD only, local currencies off**, no country-specific price adjustments. |
| B7 | Payment for the difference | With overage allowed, a real payment provider is needed. | Enable **Shopify Payments** (MerchUp entity, Poland is supported) or another gateway. Check that a USD store with PLN payout works (conversion fees). Turn off manual payment methods. Gift card + card split payment is native. |
| B8 | Tax/duties | Tax added on top makes the voucher fall short. | Turn tax collection off in every region and turn duties/import taxes off (DDP is handled by MerchUp logistics). **Accountant sign-off.** |
| B9 | Branded login page | Brief: a fully branded login page with a centred form and the MerchUp footer. **New (passwordless) customer accounts are Shopify-hosted.** Branding is limited to logo, colours and background through the checkout & accounts editor, and there is **no custom footer or layout**. Legacy accounts are deprecated, so avoid them. | Two-layer approach: (1) a **Locksmith "locked" landing page** rendered by the theme, fully on-brand (red, cream, logo, pill, MerchUp footer) with a centred **"Sign in with your XTB email"** CTA; (2) the Shopify-hosted OTP page branded as far as the editor allows. Tell the client the OTP screen itself can't carry the footer. |
| B10 | Tagging timing | Flow tags the customer asynchronously after the account is created, so the first page load after the first login can be denied. | Check whether Locksmith can key on **email domain** directly (wildcard `*@xtb.com`, …). If so, use it as the primary key and keep Flow tagging for reporting. Otherwise, the locked page shows "Verifying… refresh in a few seconds" with an auto-reload. |
| B11 | Leak via channels/endpoints | Shop app, Google and `products.json` can expose the catalogue. | Remove the Shop/Google/Facebook sales channels, Online Store only. Turn on noindex for the theme. Locksmith hides content from search. JSON endpoints are a low-risk leak: accept it (prices are in coins and there's nothing sensitive). |
| B12 | View-only XTB staff | Grow plan = **5 staff accounts**. | Use granular permissions (view orders, products, inventory). Agency people use collaborator accounts, which don't count against the limit. If XTB needs more than about 3 seats, flag it. |
| B13 | Login footer + "lands on listing" | After login, the return URL defaults to the account page. | Sign-in CTA uses `?return_url=/collections/all`. Homepage = product grid, so the root URL is the listing anyway. |
| B14 | Fonts | The card uses a geometric sans plus a hand-drawn display face ("CHEERS!"), which may not be in the Shopify font library. | Ask the client for the font files and licence. Self-host via `@font-face` in theme assets. Fallback: closest Shopify library fonts. |

---

## 2. Needs / inputs checklist (blocking items marked ⛔)
- ⛔ Logo set: SVG master, PNG ≥1000px, cream version, 512² favicon (brief §8).
- ⛔ Client sign-off on "employee may pay difference" (overrides brief §4).
- ⛔ Voucher amounts + quantities per batch (first batch = 50).
- ⛔ Product list, variants, prices in USD (= coins), mockups, descriptions (MerchUp).
- ⛔ Accountant OK on zero tax at checkout.
- Font files/licence; sparkle/hand-drawn accent SVGs.
- Shopify Payments onboarding details (MerchUp legal entity).
- XTB staff emails (later). MerchUp: InPost plugin, privacy policy, T&Cs, branded notification emails (out of our scope, §9).
- Collaborator access to the Grow store.

---

## 3. Build plan (in order)

**Phase 0 – Spikes (do first, ~½ day, on the real store or a dev store)**
1. B1: Flow → `giftCardDeactivate` with a real gift-card order. Confirm `receiptJson.gift_card_id` is available in Flow.
2. Split payment (gift card + card) with Shopify Payments in test mode. Check that the storefront shows coins and checkout shows `$`.
3. Locksmith + new customer accounts: email-domain key vs tag key, and first-login timing (B10).
4. Compare cost of the gift card apps (BatchCard / Datora / Matrixify) for code + expiry export.

**Phase 1 – Store settings**
- Store name, English only, USD, money formats → Coins (all 4).
- Single market, USD only, no local currencies. Remove extra sales channels.
- Taxes off, duties off. Shopify Payments on, manual payments off.
- Shipping: zones for EU (CY, CZ, DE, ES, FR, PT, RO, SK) + non-EU (CL, AE, GB, ID, BZ) + Rest of World, all courier rates **$0**. Phone number required at checkout. InPost is added later by MerchUp (make sure its rates are also $0).
- Checkout & accounts editor branding (logo, #C20100 / #FEF7E0 / #070809).
- Staff: view-only permission template for XTB.

**Phase 2 – Access**
- Flow: *Customer created* → email ends with one of the 16 domains → add tag `xtb-verified`.
- Locksmith: lock the entire store. Key = tag `xtb-verified` (and/or email-domain key). Locked page = custom branded section (B9). Exceptions: the How-to-order page stays locked, and policies stay public.

**Phase 3 – Vouchers**
- Install the chosen bulk app. Generate batch 1 (50 cards, `expiresOn` = issue + 1y). Export the CSV with full codes.
- Flow: deactivate gift card after order (from the spike) + tag the order.
- Flow: low-stock alert at 20 units (native template).
- Training doc + session for XTB: generate batch → set expiry → export → distribute; reissue after a refund.

**Phase 4 – Horizon theme** (`git clone https://github.com/Shopify/horizon.git`, push with Shopify CLI as an unpublished theme)
- Colour palette (`settings.color_palette` + `palette_*` button settings, rendered by `snippets/color-palette.liquid`): red bg / cream text, black pill accent. Buttons are cream on black, pill radius.
- Typography: self-hosted fonts in `assets/` + `@font-face` in the theme's CSS/`snippets` head.
- Header: logo (cream version), links = Products, How to order, Account. No search or currency/country selector.
- Homepage (`templates/index.json`) = brand hero (short "Thank you! Keep setting the High Bar." band + "we are xtb" pill) + product grid. Or redirect to `/collections/all`.
- Product/collection/cart: hide dynamic checkout buttons. Cart note text: "Enter your voucher code at checkout". Remove "taxes/shipping calculated" copy.
- Footer group (`sections/footer-group.json`): "This store is operated by [MerchUp](https://www.merchup.com)" with `target="_blank" rel="noopener"`, on every page including the Locksmith locked page.
- Pages: `templates/page.how-to-order.json` (steps + screenshot of the checkout gift card field + 1 coin = $1 note).
- `templates/gift_card.liquid` restyled.
- (Checked: Horizon JS money formatting follows `shop.money_format`, so no JS patch is needed for B5.)
- Hand-drawn sparkle SVG accents as a snippet.

**Phase 5 – QA & handover**: see Verification. Then publish the theme, add staff accounts, and hand over the training doc.

---

## 4. Verification (end-to-end)
1. Non-XTB email signs up → sees only the branded locked page. An xtb.pl email signs up → lands on the product listing within one refresh.
2. All storefront prices, cart and gift card page read "XX XTB Coins". No `$` anywhere except checkout and the account pages.
3. Order fully covered by the voucher → $0 shipping, $0 tax, order completes. Gift card shows **disabled** in admin within about 1 minute, and the remaining balance can't be reused in a second checkout.
4. Order over the voucher value → checkout asks for the card difference → split payment succeeds (test mode).
5. Checkout with a test address in each listed country → courier option at $0. In Poland, InPost appears once MerchUp connects it.
6. Expired-card test (create one with a past expiry) → rejected at checkout.
7. Low-stock email fires when a variant drops to 20. XTB staff account can view but not edit.
8. Mobile + desktop check of the locked page, listing, product, cart, How to order, and footer link opening in a new tab.
