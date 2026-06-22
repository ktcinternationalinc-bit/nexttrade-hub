# Wave public GraphQL API — money-transaction capability (live-verified evidence)

**Endpoint:** `https://gql.waveapps.com/graphql/public`
**Verified:** live schema introspection on 2026-06-21 and re-confirmed 2026-06-22 (HTTP 200 both times).
**Why this file exists:** Codex QA required raw introspection evidence saved (not "trust me") before
the bank-transaction Wave sync is considered closed. This documents exactly what the public API can and
cannot do, so nobody re-litigates it from memory.

---

## 1. WRITE is supported — `moneyTransactionCreate` exists (overturns the old "can't push" belief)

The public schema exposes the mutations `moneyTransactionCreate` and the batch `moneyTransactionsCreate`.
This overturned the project's earlier assumption that Wave's API had no generic transaction/expense create.

Mutation used by the Hub (`src/app/api/wave/push-transaction/route.js`):

```graphql
mutation($input: MoneyTransactionCreateInput!){
  moneyTransactionCreate(input:$input){ didSucceed inputErrors{ message code path } transaction{ id } }
}
```

Input shape (from the live `MoneyTransactionCreateInput` / anchor / line-item input types):

- `MoneyTransactionCreateInput`: `businessId: ID!`, `externalId: String!` (input-only — never echoed back),
  `date: Date!`, `description: String!`, `anchor: MoneyTransactionCreateAnchorInput!`,
  `lineItems: [MoneyTransactionCreateLineItemInput!]!`.
- `MoneyTransactionCreateAnchorInput` (the bank/cash side): `accountId: ID!`, `amount: Decimal!` (unsigned),
  `direction: TransactionDirection!` = `DEPOSIT | WITHDRAWAL`.
- `MoneyTransactionCreateLineItemInput` (the category side): `accountId: ID!`, `amount`, `balance: INCREASE | DECREASE`.

Hub double-entry mapping: anchor = the silo's Wave Cash & Bank account (money-in → `DEPOSIT`,
money-out → `WITHDRAWAL`); single line item = the assigned Wave category account, `balance: INCREASE`.
`externalId = 'hub-bt-' + bank_transactions.id` → Wave itself rejects a duplicate push (idempotency).

## 2. READ is NOT supported — there is no way to query/list money transactions

Live introspection, confirmed three independent ways:

1. `Business` type fields contain **no** `transactions` and **no** `moneyTransactions` connection. Its full
   connection list is: customers, customer, accounts, account, salesTaxes, salesTax, invoices, invoice,
   invoicePayment, vendors, vendor, products, product, estimates, estimate, estimatePayment.
2. The `Transaction` OBJECT type exposes **exactly one** field: `id`. No date, description, amount,
   direction, lineItems, account, anchor, externalId, or balance is readable.
3. Root `Query` has no money-transaction entry point: `_`, oAuthApplication, currencies, currency,
   countries, country, businesses, business, user, accountTypes, accountSubtypes.

Introspection used to prove it (Wave requires variables for `__type` name args):

```graphql
query($n:String!){ __type(name:$n){ name fields{ name } } }   # variables {"n":"Business"}  -> no transactions/moneyTransactions
query($n:String!){ __type(name:$n){ name kind fields{ name } } } # variables {"n":"Transaction"} -> fields:[{name:"id"}]
query{ __schema{ queryType{ fields{ name } } } }                 # -> no money-transaction query
```

The intended read query fails validation:
`business(id){ moneyTransactions(...) }` → `GRAPHQL_VALIDATION_FAILED "Cannot query field \"moneyTransactions\" on type \"Business\"."`

## 3. Consequences for the Hub

- **Pull existing Wave categorizations (Max "item 2"): not possible via the public API.** Nothing to read.
- **Reconciliation is Hub-side only.** For transactions the Hub pushes, the durable link is
  `bank_transactions.wave_transaction_id` (stored from the create response) + the deterministic
  `externalId = 'hub-bt-<id>'`, with `category_status='synced'`. No Wave read-back needed or possible.
- **Transactions created directly in Wave's UI** cannot be discovered or matched via the API. The only
  out-of-band path is Wave's CSV export (Accounting → Transactions → Export), matched heuristically on
  date + abs(amount) + direction + normalized description. (CSV import is a separate, opt-in tool.)
- **Also NOT in the public API:** bank-to-bank transfers, raw journal entries, money-transaction
  update/delete. So an already-pushed transaction cannot be edited/reversed via API — it must be
  reversed in Wave's UI (the Hub blocks re-categorizing a synced transaction, see bank-write `classify`).

## 4. Where this is enforced in code

- Push: `src/app/api/wave/push-transaction/route.js` (gated, dry-run, idempotent, single-anchor safety).
- Edit-after-push block: `src/app/api/accounting/bank-write/route.js` (`classify` / `set_wave_category`).
- Multi-account anchor safety: push-transaction blocks a silo with >1 bank account until per-account
  Wave-bank mapping exists (so a ··6338 txn can't post to the ··6353 Wave account).
