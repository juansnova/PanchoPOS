# Colombia DIAN electronic invoicing — provider ADR

## Purpose

Decision record for how Satisfecho issues Colombia DIAN electronic invoices (`dian_mode: live`)
for tenants that operate under Colombian tax law (e.g. Pancho Panza, tenant 403).

This is an **independent regime** from Spain VeriFactu (`docs/0065-verifactu-production.md`,
`docs/0074-fiscal-certified-middleware.md`) and Germany TSE (`docs/0072-tse-fiscal-compliance.md`).
Different law, different document format (UBL 2.1 + CUFE, not AEAT huella / TSE signatures),
separate code paths (`app/dian_invoice_service.py`, `app/dian_providers.py`), separate tenant
config (`dian_mode`, `dian_tax_regime`, `dian_client_id`), separate DB table (`dian_invoice`).
No shared code with the Spain/Germany modules beyond the overall request/response/hash-style
pattern.

## Decision summary

| Option | Shape | Effort | Notes |
|--------|-------|--------|-------|
| **Certified technology provider via API (chosen)** | REST, OAuth2 password grant, provider builds UBL 2.1 XML/CUFE/signature and files with DIAN | Days to integrate | **Chosen primary: Factus** (`developers.factus.com.co`). Free tier for low monthly volume fits a single restaurant. |
| Direct DIAN habilitación | In-house digital certificate, DIAN sandbox habilitación testing, own UBL 2.1 signing | Weeks of certification + ongoing schema maintenance | Rejected — not justified for this tenant's volume. |
| DIAN's free web portal | Manual web form, one invoice at a time | No automation possible | Rejected — cannot be called from the POS at checkout; unworkable at restaurant order volume. |

## Provider wiring (POS)

- `app/dian_providers.py`: `submit_dian_invoice()` dispatches to `mock` (dev/tests) or `factus`.
  Factus auth: `POST {base}/oauth/token` (password grant: `client_id`, `client_secret`,
  `username`, `password`) → bearer token. Invoice create: `POST {base}/v2/bills/validate`;
  credit note: `POST {base}/v2/credit-notes/validate`. Sandbox base
  `https://api-sandbox.factus.com.co`, live `https://api.factus.com.co`.
- **Field mapping in `_submit_factus` is a best-effort draft from Factus's public docs and has
  not been verified against a real sandbox account.** Before going live, create a Factus sandbox
  account, issue a real test invoice, and correct the payload shape against actual
  accepted/rejected responses. Do not assume the current mapping is production-correct.
- `app/dian_invoice_service.py` owns: eligibility (order must be `paid`/`completed`),
  idempotency (one active invoice per order), credit-note cancellation, and persistence to the
  `dian_invoice` table.
- Live requires provider acceptance (`provider_accepted` / `mock_accepted`); failures return
  **502**, mirroring the VeriFactu/TSE pattern.
- Env: `DIAN_PROVIDER` (`mock` | `factus`), `DIAN_PROVIDER_CLIENT_ID`,
  `DIAN_PROVIDER_CLIENT_SECRET`, `DIAN_PROVIDER_USERNAME`, `DIAN_PROVIDER_PASSWORD`, optional
  `DIAN_PROVIDER_BASE_URL`, `DIAN_LIVE_UNLOCK`.
- Tenant fields: `dian_mode` (off|test|live), `dian_tax_regime`
  (`responsable_iva` | `regimen_simple` — confirm with the restaurant's accountant before
  going live; it changes whether IVA is discriminated on the invoice), `dian_client_id`
  (provider-side identifier, if Factus requires one beyond account credentials),
  `dian_invoice_next_number` (local bookkeeping; Factus manages its own DIAN-authorized
  numbering range — see `numbering_range_id` in their docs if the tenant has multiple ranges).

## Live-enable guards

| Gate | DIAN |
|------|------|
| Unlock flag | `DIAN_LIVE_UNLOCK=true` |
| Credentials | `DIAN_PROVIDER=factus` + client_id/secret/username/password all set |
| Mock in prod | Forbidden (`live_credentials_ready()` returns false for `mock` when `is_production`) |
| Settings UI | `dian_mode: live` → 400 if gated |
| Issue/cancel | 502 if provider rejects or is unreachable |

## Ops blockers (honest status)

- No Factus account exists yet for Pancho Panza. Real `live` submission is **not possible**
  until: (1) the restaurant signs up with Factus (or chosen provider) with real NIT/tax data,
  (2) the owner's accountant confirms `dian_tax_regime`, (3) sandbox credentials are set in
  `config.env` and a real test invoice is issued and inspected.
- Until then, keep `DIAN_LIVE_UNLOCK=false` and `dian_mode=off` (or `test` with `DIAN_PROVIDER=mock`
  for local vertical-slice testing only).
- `mock` provider is for local development / tests only — never a substitute for a real DIAN
  filing, and blocked outright in production.

## Testing

- Manual: set `DIAN_PROVIDER=mock`, `dian_mode=test` on a tenant, issue `/orders/{id}/dian-invoice/issue`,
  confirm `submission_status=mock_accepted` and a mock CUFE; cancel via
  `/orders/{id}/dian-invoice/cancel` and confirm the original flips to `cancelled` and a
  `credit_note` row is created.
- No automated pytest coverage yet — add `back/tests/test_dian_invoice_api.py` mirroring
  `test_fiscal_invoice_api.py` before relying on this in CI.
