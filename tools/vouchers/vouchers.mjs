#!/usr/bin/env node
/**
 * XTBCelebrated voucher tool (Node 18+, no dependencies).
 *
 *   node tools/vouchers/vouchers.mjs create --value 100 --count 50 [--expires 2027-11-25] [--note "Batch 1"]
 *   node tools/vouchers/vouchers.mjs sweep [--apply]
 *
 * create  Issues gift cards via the Admin API and appends each full code to
 *         tools/vouchers/out/<batch>.csv as soon as it exists (Shopify only shows
 *         the full code once, at creation). Expiry defaults to today + 1 year.
 * sweep   Lists enabled gift cards that were partly spent and deactivates them
 *         (safety net for the Flow that does this after each order). Dry run
 *         unless --apply is passed.
 *
 * Credentials (env vars or tools/vouchers/.env): SHOPIFY_SHOP (subdomain, without
 * .myshopify.com), SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET of a Dev Dashboard app
 * installed on the store with scopes read_gift_cards, write_gift_cards.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_VERSION = '2026-10';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out');
let accessToken;

loadEnvFile(join(HERE, '.env'));
const { SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

const commands = { create, sweep };
if (!commands[command]) {
  console.error('Usage: vouchers.mjs create --value <amount> --count <n> [--expires YYYY-MM-DD] [--note text]');
  console.error('       vouchers.mjs sweep [--apply]');
  process.exit(1);
}
if (!SHOPIFY_SHOP || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
  console.error('Missing SHOPIFY_SHOP, SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET (env or tools/vouchers/.env).');
  process.exit(1);
}

commands[command](args).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

// --- commands ---------------------------------------------------------------

async function create({ value, count, expires = oneYearFromToday(), note }) {
  const amount = Number(value);
  const total = Number(count);
  if (!(amount > 0) || !Number.isInteger(total) || total < 1) throw new Error('--value and --count must be positive numbers.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error('--expires must be YYYY-MM-DD.');

  const { shop } = await graphql('{ shop { currencyCode } }');
  const batch = `${today()}_${amount}-${shop.currencyCode}_x${total}`;
  const file = join(OUT_DIR, `${batch}.csv`);
  if (existsSync(file)) throw new Error(`${file} already exists. Move it away before creating the same batch again.`);

  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(file, 'code,value,currency,expires_on,gift_card_id\n');

  for (let i = 1; i <= total; i++) {
    const { giftCardCreate } = await graphql(
      `mutation ($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCard { id expiresOn }
          giftCardCode
          userErrors { field message }
        }
      }`,
      {
        input: {
          initialAmount: { amount: amount.toFixed(2), currencyCode: shop.currencyCode },
          expiresOn: expires,
          note: note || `XTBCelebrated ${batch}`,
        },
      },
    );
    assertNoUserErrors(giftCardCreate.userErrors, `card ${i}`);

    const { giftCard, giftCardCode } = giftCardCreate;
    appendFileSync(file, `${giftCardCode.toUpperCase()},${amount},${shop.currencyCode},${giftCard.expiresOn},${giftCard.id}\n`);
    process.stdout.write(`\rCreated ${i}/${total}`);
  }

  console.log(`\nSaved ${file}`);
  console.log('This file holds live voucher codes: share it only with XTB and never commit it.');
}

async function sweep({ apply = false }) {
  const partlySpent = [];
  let after = null;

  do {
    const { giftCards } = await graphql(
      `query ($after: String) {
        giftCards(first: 100, after: $after, query: "status:enabled AND balance_status:partial") {
          nodes { id lastCharacters balance { amount } initialValue { amount } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    partlySpent.push(...giftCards.nodes);
    after = giftCards.pageInfo.hasNextPage ? giftCards.pageInfo.endCursor : null;
  } while (after);

  if (partlySpent.length === 0) return console.log('No partly spent gift cards are still enabled.');

  for (const card of partlySpent) {
    const label = `…${card.lastCharacters} (balance ${card.balance.amount} of ${card.initialValue.amount})`;
    if (!apply) {
      console.log(`Would deactivate ${label}`);
      continue;
    }
    const { giftCardDeactivate } = await graphql(
      `mutation ($id: ID!) { giftCardDeactivate(id: $id) { giftCard { id } userErrors { field message } } }`,
      { id: card.id },
    );
    assertNoUserErrors(giftCardDeactivate.userErrors, label);
    console.log(`Deactivated ${label}`);
  }

  if (!apply) console.log(`\n${partlySpent.length} card(s) found. Run again with --apply to deactivate them.`);
}

// --- Admin API --------------------------------------------------------------

async function getAccessToken() {
  if (accessToken) return accessToken;
  const response = await fetch(`https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!response.ok) throw new Error(`Access token request failed: ${response.status} ${await response.text()}`);
  ({ access_token: accessToken } = await response.json());
  return accessToken;
}

async function graphql(query, variables = {}, attempt = 1) {
  const response = await fetch(`https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getAccessToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Admin API request failed: ${response.status} ${await response.text()}`);

  const { data, errors } = await response.json();
  const throttled = errors?.some((error) => error.extensions?.code === 'THROTTLED');
  if (throttled && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    return graphql(query, variables, attempt + 1);
  }
  if (errors?.length) throw new Error(`Admin API errors: ${JSON.stringify(errors)}`);
  return data;
}

function assertNoUserErrors(userErrors, context) {
  if (userErrors.length) throw new Error(`${context}: ${userErrors.map((error) => error.message).join('; ')}`);
}

// --- helpers ----------------------------------------------------------------

function parseArgs(list) {
  const parsed = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue;
    const key = list[i].slice(2);
    const next = list[i + 1];
    parsed[key] = next === undefined || next.startsWith('--') ? true : (i++, next);
  }
  return parsed;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromToday() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
