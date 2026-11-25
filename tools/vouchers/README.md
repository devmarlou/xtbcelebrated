# Voucher sheet (Google Sheets extension)

A Google Sheet with a **Vouchers** menu that creates XTBCelebrated vouchers (native Shopify gift cards) in bulk. It keeps every full code in the sheet and shows each voucher's live status. There is no app fee and nothing to host. It runs as Apps Script inside the sheet.

Why: the Shopify admin creates gift cards one at a time and only shows the last 4 characters afterwards. Matrixify does not support gift cards. The Admin API returns the full code once, at creation, and the sheet writes it straight into a row.

| Menu item | What it does |
|---|---|
| **Create batch…** | Dialog with value, quantity, expiry (default today + 1 year) and an optional batch name. Each voucher appears as a new row as soon as it exists. About 5 minutes per run (Apps Script limit); if a big batch stops early, it says how many are left to create. |
| **Refresh status** | Updates Status (`Unused`, `Part used`, `Used`, `Deactivated`, `Expired`) and Balance for every row from Shopify. |
| **Deactivate part-used vouchers…** | Safety net for the Flow that deactivates a voucher after its order. Lists active, part-spent vouchers, asks for confirmation, and deactivates them. Their remaining balance is forfeited, and this can't be undone. |
| **Connect store…** | Saves the store and app credentials in Script Properties, not in cells. |

Files: `Code.gs` (logic), `CreateBatch.html` (dialog), `appsscript.json` (manifest: only this sheet, UI, outbound requests).

## One-time setup

### 1. Shopify app (gives the sheet API access)
1. Go to [Dev Dashboard](https://dev.shopify.com/dashboard), choose **Apps**, then **Create app**, and name it "XTBCelebrated vouchers". Use the organisation the store belongs to.
2. Create a version with the scopes `read_gift_cards` and `write_gift_cards`, then release it.
3. Install the app on the store and approve the scopes.
4. Under **Settings**, keep the Client ID and Client secret ready for step 2.

The token request (client credentials grant) only works when the app and the store are in the **same organisation**. If the store moves to the client's own account, create the app again from that account and reconnect.

### 2. Google Sheet
1. Create a blank Google Sheet, e.g. "XTBCelebrated vouchers". Share it **only** with the people who issue vouchers.
2. Go to **Extensions** → **Apps Script**.
3. In **Project Settings** (gear icon), tick **Show "appsscript.json" manifest file in editor**.
4. Replace the contents of `Code.gs` and `appsscript.json` with the files from this folder. Add an HTML file named `CreateBatch` (the editor adds `.html`) with `CreateBatch.html`. Save.
5. Reload the sheet. The **Vouchers** menu appears. Choose **Connect store…** and enter:
   - the store subdomain (`xtbcelebrated-pmfbmesf`)
   - the Client ID
   - the Client secret
6. Approve the Google permissions prompt the first time.

The `Vouchers` tab is created on the first batch.

Alternative to copy-paste: [`clasp`](https://github.com/google/clasp) (`clasp create --type sheets`, then `clasp push` from this folder).

## Security
- The sheet holds **live voucher codes**. Keep sharing restricted, and don't download or forward copies beyond what XTB needs to distribute.
- Anyone who can edit the sheet can open the script and its properties, including the client secret. Editors should be voucher admins only. Give everyone else view access to a filtered copy, or none.
- If the secret leaks, rotate it in Dev Dashboard and run **Connect store…** again.
