# Voucher tool

Creates XTBCelebrated vouchers (Shopify gift cards) in bulk and saves the full codes to a CSV that XTB distributes. It also has a safety-net sweep that deactivates part-spent cards. There is no monthly app fee and nothing to host: it runs locally with Node 18+.

Why a script: the Shopify admin creates gift cards one at a time and only ever shows the last 4 characters afterwards. Matrixify does not support gift cards. The Admin API returns the full code once, at creation, and this script writes it straight to the CSV.

## One-time setup

1. **Create the app.** Go to [Dev Dashboard](https://dev.shopify.com/dashboard), choose **Apps**, then **Create app**, and name it "XTBCelebrated vouchers". Use the organisation the store belongs to.
2. **Set scopes.** Create a version with the access scopes `read_gift_cards` and `write_gift_cards`, then release it.
3. **Install it.** Install the app on the store and approve the scopes.
4. **Add credentials.** Under **Settings**, copy the Client ID and Client secret into `tools/vouchers/.env`. This file is gitignored.

   ```sh
   SHOPIFY_SHOP=xtbcelebrated-pmfbmesf
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   ```

The token request (client credentials grant) only works when the app and the store are in the **same organisation**. If the store moves to the client's own account, create the app again from that account.

## Create a batch

```sh
node tools/vouchers/vouchers.mjs create --value 100 --count 50
node tools/vouchers/vouchers.mjs create --value 150 --count 20 --expires 2027-12-31 --note "Batch 2"
```

- `--value` is in the store currency (USD, where 1 XTB Coin = $1).
- `--expires` defaults to today + 1 year (YYYY-MM-DD).
- Output goes to `tools/vouchers/out/<date>_<value>-USD_x<count>.csv` with the columns `code,value,currency,expires_on,gift_card_id`.
- Each row is written the moment its card exists. If a run stops halfway, the CSV still holds every card created so far. Check the row count before re-running with the remaining count.
- **The CSV holds live codes.** Send it to XTB over a secure channel, never commit it, and delete local copies after handover.

## Sweep (safety net)

The Flow "Deactivate voucher after order" handles single use. The sweep catches anything Flow missed, for example a failed run:

```sh
node tools/vouchers/vouchers.mjs sweep          # dry run: lists enabled, part-spent cards
node tools/vouchers/vouchers.mjs sweep --apply  # deactivates them (cannot be undone)
```

The sweep only touches cards with `status:enabled AND balance_status:partial`. Unused cards are never affected.
