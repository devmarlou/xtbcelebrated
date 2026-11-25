/**
 * XTBCelebrated vouchers: Google Sheets extension (Apps Script bound to the sheet).
 *
 * Adds a "Vouchers" menu that creates Shopify gift cards in bulk, writes each full
 * code to the "Vouchers" tab the moment it exists (Shopify only shows it once),
 * refreshes balances/status, and deactivates part-used cards (safety net for Flow).
 *
 * Credentials live in Script Properties (Vouchers → Connect store), never in cells.
 */

const API_VERSION = '2026-10';
const SHEET_NAME = 'Vouchers';
const HEADERS = ['Code', 'Value', 'Currency', 'Expires on', 'Batch', 'Created', 'Status', 'Balance', 'Checked', 'Gift card ID'];
const FORMATS = ['@', '0', '@', '@', '@', 'yyyy-mm-dd hh:mm', '@', '0.00', 'yyyy-mm-dd hh:mm', '@'];
const COL = Object.fromEntries(HEADERS.map((header, index) => [header, index + 1]));
const TIME_BUDGET_MS = 5 * 60 * 1000; // Apps Script stops runs at 6 minutes
const STATUS_CHUNK = 100;

// --- menu -------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Vouchers')
    .addItem('Create batch…', 'showCreateBatch')
    .addItem('Refresh status', 'refreshStatus')
    .addSeparator()
    .addItem('Deactivate part-used vouchers…', 'deactivatePartUsed')
    .addSeparator()
    .addItem('Connect store…', 'connectStore')
    .addToUi();
}

function showCreateBatch() {
  const html = HtmlService.createHtmlOutputFromFile('CreateBatch').setWidth(380).setHeight(430);
  SpreadsheetApp.getUi().showModalDialog(html, 'Create voucher batch');
}

function connectStore() {
  const ui = SpreadsheetApp.getUi();
  const ask = (title, hint) => {
    const response = ui.prompt(title, hint, ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) throw new Error('Cancelled.');
    return response.getResponseText().trim();
  };

  try {
    const shop = ask('Store', 'Store subdomain, e.g. xtbcelebrated-pmfbmesf (without .myshopify.com)').replace(/\.myshopify\.com$/, '');
    const clientId = ask('Client ID', 'Dev Dashboard → your app → Settings → Client ID');
    const clientSecret = ask('Client secret', 'Dev Dashboard → your app → Settings → Client secret');

    PropertiesService.getScriptProperties().setProperties({ SHOPIFY_SHOP: shop, SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret });
    CacheService.getScriptCache().remove('token');

    const { shop: info } = graphql_('{ shop { name currencyCode } }');
    ui.alert(`Connected to ${info.name} (${info.currencyCode}).`);
  } catch (error) {
    ui.alert(error.message);
  }
}

// --- create -----------------------------------------------------------------

/** Called from CreateBatch.html. Returns a message for the dialog. */
function createBatch(form) {
  const value = Number(form.value);
  const count = Number(form.count);
  const expires = String(form.expires || '');
  if (!(value > 0) || !Number.isInteger(count) || count < 1) throw new Error('Value and quantity must be positive numbers.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error('Pick an expiry date.');

  const started = Date.now();
  const { shop } = graphql_('{ shop { currencyCode } }');
  const currency = shop.currencyCode;
  const batch = form.note ? String(form.note).trim() : `${today_()} · ${value} ${currency} × ${count}`;
  const sheet = getSheet_();

  let created = 0;
  while (created < count && Date.now() - started < TIME_BUDGET_MS) {
    const { giftCardCreate } = graphql_(
      `mutation ($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCard { id expiresOn }
          giftCardCode
          userErrors { message }
        }
      }`,
      { input: { initialAmount: { amount: value.toFixed(2), currencyCode: currency }, expiresOn: expires, note: `XTBCelebrated · ${batch}` } },
    );
    assertNoUserErrors_(giftCardCreate.userErrors);

    const { giftCard, giftCardCode } = giftCardCreate;
    writeRow_(sheet, [giftCardCode.toUpperCase(), value, currency, giftCard.expiresOn, batch, new Date(), 'Unused', value, new Date(), giftCard.id]);
    created++;
  }

  return created === count
    ? `Created ${count} vouchers in batch "${batch}".`
    : `Created ${created} of ${count} before the time limit. Run Create batch again for the remaining ${count - created}.`;
}

// --- status -----------------------------------------------------------------

function refreshStatus() {
  const sheet = getSheet_();
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return toast_('No vouchers yet.');

  const ids = sheet.getRange(2, COL['Gift card ID'], rows, 1).getValues().map(([id]) => id);
  const updates = [];

  for (let start = 0; start < ids.length; start += STATUS_CHUNK) {
    const chunk = ids.slice(start, start + STATUS_CHUNK);
    const { nodes } = graphql_(
      `query ($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on GiftCard { id enabled expiresOn balance { amount } initialValue { amount } }
        }
      }`,
      { ids: chunk.filter(Boolean) },
    );
    const byId = Object.fromEntries(nodes.filter(Boolean).map((card) => [card.id, card]));
    for (const id of chunk) {
      const card = byId[id];
      updates.push(card ? [statusOf_(card), Number(card.balance.amount), new Date()] : ['Not found', '', new Date()]);
    }
  }

  sheet.getRange(2, COL.Status, updates.length, 3).setValues(updates);
  toast_(`Updated ${updates.length} vouchers.`);
}

function statusOf_(card) {
  const balance = Number(card.balance.amount);
  if (!card.enabled) return 'Deactivated';
  if (card.expiresOn && card.expiresOn < today_()) return 'Expired';
  if (balance === 0) return 'Used';
  if (balance < Number(card.initialValue.amount)) return 'Part used';
  return 'Unused';
}

// --- deactivate -------------------------------------------------------------

function deactivatePartUsed() {
  const ui = SpreadsheetApp.getUi();
  const cards = [];
  let after = null;

  do {
    const { giftCards } = graphql_(
      `query ($after: String) {
        giftCards(first: 100, after: $after, query: "status:enabled AND balance_status:partial") {
          nodes { id lastCharacters }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    cards.push(...giftCards.nodes);
    after = giftCards.pageInfo.hasNextPage ? giftCards.pageInfo.endCursor : null;
  } while (after);

  if (cards.length === 0) return ui.alert('No part-used vouchers are still active.');

  const list = cards.map((card) => `…${card.lastCharacters}`).join(', ');
  const confirm = ui.alert(
    `Deactivate ${cards.length} part-used voucher(s)?`,
    `${list}\n\nTheir remaining balance is forfeited. This cannot be undone.`,
    ui.ButtonSet.YES_NO,
  );
  if (confirm !== ui.Button.YES) return;

  for (const card of cards) {
    const { giftCardDeactivate } = graphql_(
      `mutation ($id: ID!) { giftCardDeactivate(id: $id) { giftCard { id } userErrors { message } } }`,
      { id: card.id },
    );
    assertNoUserErrors_(giftCardDeactivate.userErrors);
  }

  refreshStatus();
  ui.alert(`Deactivated ${cards.length} voucher(s).`);
}

// --- Admin API --------------------------------------------------------------

function credentials_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.SHOPIFY_SHOP || !props.SHOPIFY_CLIENT_ID || !props.SHOPIFY_CLIENT_SECRET) {
    throw new Error('Store not connected. Use Vouchers → Connect store first.');
  }
  return props;
}

function accessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('token');
  if (cached) return cached;

  const { SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = credentials_();
  const response = UrlFetchApp.fetch(`https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Shopify refused the credentials (${response.getResponseCode()}). Check Vouchers → Connect store.`);
  }

  const token = JSON.parse(response.getContentText()).access_token;
  cache.put('token', token, 6 * 60 * 60); // tokens last 24h; cache max is 6h
  return token;
}

function graphql_(query, variables = {}, attempt = 1) {
  const { SHOPIFY_SHOP } = credentials_();
  const response = UrlFetchApp.fetch(`https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': accessToken_() },
    payload: JSON.stringify({ query, variables }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Shopify API error ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`);
  }

  const { data, errors } = JSON.parse(response.getContentText());
  const throttled = errors && errors.some((error) => error.extensions && error.extensions.code === 'THROTTLED');
  if (throttled && attempt < 5) {
    Utilities.sleep(2000 * attempt);
    return graphql_(query, variables, attempt + 1);
  }
  if (errors && errors.length) throw new Error(`Shopify API: ${errors.map((error) => error.message).join('; ')}`);
  return data;
}

function assertNoUserErrors_(userErrors) {
  if (userErrors.length) throw new Error(userErrors.map((error) => error.message).join('; '));
}

// --- sheet helpers ----------------------------------------------------------

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/** Appends one voucher row. Text formats keep codes like "1234E567…" from being read as numbers. */
function writeRow_(sheet, values) {
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setNumberFormats([FORMATS]).setValues([values]);
}

function toast_(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Vouchers');
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
