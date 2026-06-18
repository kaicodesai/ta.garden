# Ta.Garden — Project Overview & Handoff Document

> **Property:** Ta.Garden, Hội An, Vietnam  
> **Operator:** Soul & Luna Wellness  
> **Contact:** hi@soulandlunawellness.com  
> **Live site:** https://ta-garden.soulandlunawellness.com

---

## What This Is

A fully custom-built property rental management system for a boutique co-living property. It replaces booking platforms (Airbnb, etc.) for direct bookings with a self-contained stack: a public landing page, a guest self-service portal, and an admin operations dashboard — all running on Cloudflare's edge network with zero servers to manage.

The system handles the complete guest lifecycle from first enquiry through check-out: enquiry capture → booking confirmation email → contract signing → onboarding checklist → payment tracking → check-out.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (serverless, edge) |
| Storage | Cloudflare KV (key-value, globally replicated) |
| Static assets | Cloudflare Workers Assets (`[assets]` binding) |
| Email | Resend API |
| Payments | Stripe (payment links embedded in emails) |
| CI/CD | GitHub Actions → `cloudflare/wrangler-action@v3` |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |

**Why this stack:** Zero cold starts, sub-100ms globally, free tier covers current traffic, deploys in ~30 seconds on every push to `main`. No database to provision, no servers to patch.

---

## Repository Structure

```
ta.garden/
├── src/
│   └── worker.js          # Entire backend — all API routes, email builders, business logic
├── public/
│   ├── index.html         # Public landing page
│   ├── guest.html         # Guest self-service portal
│   ├── admin.html         # Admin operations dashboard
│   └── _headers           # Cloudflare asset response headers (Cache-Control)
├── wrangler.toml          # Cloudflare Workers config
└── .github/
    └── workflows/
        └── deploy.yml     # GitHub Actions CI/CD — auto-deploys main to production
```

### `src/worker.js`

Single file, ~3500+ lines. Contains:
- All HTTP route handlers (`/api/*`)
- Email HTML builders (`buildConfirmEmail`, `buildContractEmail`, `buildColtContractEmail`, etc.)
- Business logic: pricing, availability, iCal sync, cron reminders
- Helper functions: auth, KV access, logging

### `public/admin.html`

~3500+ lines. Single-page admin app. All state is managed in JS variables (`allEnquiries`, `currentProp`, etc.). Communicates with the worker via `fetch()` calls with `x-admin-secret` header.

### `public/guest.html`

~600+ lines. Single-page guest portal. Authenticates via URL param (`?id=` or `?token=`). Loads all data from `/api/guest` on init.

---

## Architecture

```
Browser
  │
  ├── GET  /              → Cloudflare Assets serves public/index.html
  ├── GET  /admin         → Cloudflare Assets serves public/admin.html
  ├── GET  /guest         → Worker redirects → /guest.html (302)
  │                          (preserves ?id= and ?p= query params)
  │
  └── /api/*              → Worker handles all API routes
                               └── Reads/writes Cloudflare KV (BOOKINGS namespace)
                                   └── Calls Resend API for emails
```

**Critical routing note:** Static files are served by Cloudflare's asset layer *before* the worker. The `[assets]` binding in `wrangler.toml` handles this automatically. Do **not** add `html_handling = "none"` or `binding = "ASSETS"` — both break asset serving for the entire site.

---

## Data Model (Cloudflare KV)

All data lives in the `BOOKINGS` KV namespace. Keys follow these patterns:

| KV Key | Value | Description |
|---|---|---|
| `enquiries` | `Enquiry[]` JSON array | All enquiries for `ta-garden` property |
| `enq_idx_{id}` | `propertyId` string | Index: enquiry ID → property ID |
| `guest__{id}` | Guest profile JSON | Passport/visa/personal details for guest |
| `payments__{id}` | `Payment[]` JSON array | Payment history for enquiry |
| `electricity__{id}` | `Bill[]` JSON array | Electricity bills for enquiry |
| `contract_{id}` | HTML string | Generated rental agreement |
| `log__{id}` | `LogEntry[]` JSON array | Activity log per enquiry |
| `blocked_{propertyId}` | `Block[]` JSON array | Manually blocked date ranges |
| `ical_{propertyId}` | `ICalEvent[]` JSON array | Synced iCal events (Airbnb, etc.) |
| `magic_{token}` | `{enquiryId, email, expires}` | 1-hour login tokens |
| `booking_link_{token}` | Booking link config | Pre-filled shareable booking forms |
| `booking_links_idx` | `string[]` token list | Index of all booking link tokens |

### Enquiry Object Shape

```js
{
  id: "enq_1781701179012",     // Timestamp-based ID, also the permanent guest auth token
  propertyId: "ta-garden",
  name: "Arita Hana",
  email: "arita@example.com",
  phone: "+1 555 000 0000",
  room: "The Sky Suite",
  stayType: "monthly",         // "monthly" | "short-stay"
  checkIn: "2026-06-21",
  checkOut: "2026-07-16",
  status: "confirmed",         // "pending" | "confirmed" | "declined"
  rentUsd: 560,
  rentVnd: 14000000,
  depositAmount: 280,
  price: 560,
  message: "Original enquiry message",
  createdAt: "2026-01-01T00:00:00.000Z",
  signedAt: "2026-01-02T00:00:00.000Z",
  archived: false,
  restored: false,
  onboarding: {
    paymentReceived: false,
    contractSigned: false,
    passportUploaded: false,
    visaUploaded: false,
  },
  stripeUrl: "https://buy.stripe.com/...",  // Optional per-booking Stripe link
  note: "Internal admin note",
}
```

---

## Rooms & Rates

Defined in `worker.js` as `ROOM_RATES` and mirrored in `admin.html` as `ROOM_RATES_JS`:

| Room | Monthly (USD) | Monthly (VND) | Nightly (USD) |
|---|---|---|---|
| The River Room | $380 | 9,500,000 | $45 |
| The Garden Room | $420 | 10,500,000 | $55 |
| The Sky Suite | $560 | 14,000,000 | $75 |
| First Floor Room | $300 | 7,500,000 | $38 |

**Prorated pricing:** Monthly stays shorter than 30 days are automatically prorated: `Math.round((days/30 * 10) / 10) * monthlyRate`. This flows through to confirmation emails, admin financial summary, and the guest portal.

**Currency:** 1 USD = 25,000 VND (hardcoded rate). VND is shown as small print throughout.

---

## API Reference

All admin endpoints require `x-admin-secret` header. Guest endpoints authenticate via `?id=` (permanent) or `?token=` (1-hour magic link).

### Public

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/enquire` | Submit booking enquiry from landing page |
| `GET` | `/api/availability` | Get blocked/booked dates for calendar |

### Guest Portal

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/guest?id={id}&p={propId}` | Load guest portal session data |
| `POST` | `/api/guest/login` | Request magic link login email |
| `POST` | `/api/guest/submit` | Submit/update guest profile |
| `POST` | `/api/guest/sign-contract` | Submit e-signature for rental agreement |
| `GET` | `/api/guest/contract?id={id}` | View rental agreement HTML |

### Admin — Enquiries

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/enquiries?p={propId}` | List all enquiries + blocked dates + iCal |
| `PATCH` | `/api/admin/enquiry` | Update dates, rates, status, email, phone |
| `DELETE` | `/api/admin/enquiry` | Delete an enquiry |
| `POST` | `/api/admin/notify` | Send confirmation/decline email; stores rates |
| `POST` | `/api/admin/note` | Add internal note to enquiry |
| `POST` | `/api/admin/restore-guest` | Restore a missing enquiry by ID (portal recovery) |

### Admin — Guest Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/guest-profile?id={id}` | Get guest profile + payments + logs |
| `PATCH` | `/api/admin/guest-profile` | Update guest profile fields or upload docs (passport/visa as base64) |
| `PATCH` | `/api/admin/onboarding` | Toggle onboarding checklist flags |

### Admin — Financial

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/payment` | Record a payment |
| `DELETE` | `/api/admin/payment` | Delete a payment record |
| `POST` | `/api/admin/electricity` | Post an electricity bill |
| `DELETE` | `/api/admin/electricity` | Delete an electricity bill |

### Admin — Booking Tools

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/direct-booking` | Create booking directly from admin |
| `POST` | `/api/admin/booking-link` | Generate a shareable booking form link |
| `GET` | `/api/admin/booking-links` | List all booking links |
| `DELETE` | `/api/admin/booking-link` | Delete a booking link |
| `POST` | `/api/admin/block` | Block a date range |
| `POST` | `/api/admin/unblock` | Unblock a date range |
| `POST` | `/api/admin/ical-sync` | Sync iCal URL (Airbnb, etc.) |

### Admin — Properties

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/properties` | List all properties |
| `POST` | `/api/admin/property` | Create/update a property |
| `DELETE` | `/api/admin/property` | Delete a property |

---

## Authentication

### Admin
- Single shared secret stored as Cloudflare Worker secret (`ADMIN_SECRET`)
- Passed as `x-admin-secret` request header from the admin dashboard
- No user accounts, no sessions — stateless

### Guest Portal
- **Permanent auth:** `?id={enquiryId}` — the enquiry ID is the permanent token. Never expires. Used in confirmation emails.
- **Magic link:** `POST /api/guest/login` sends a 1-hour token to the guest's email. URL: `/guest.html?token={token}&p={propId}`. After validation, the token is exchanged for the permanent ID and the guest is redirected.
- The permanent `?id=` link should always be used in guest-facing communications. The `?token=` link is only for re-authentication if a guest loses their link.

---

## Email System

All emails are sent via **Resend API** (`RESEND_API_KEY` Cloudflare secret). From address: `Ta.Garden <bookings@mail.soulandlunawellness.com>`.

| Email | Trigger | Template function |
|---|---|---|
| Booking confirmation | Admin clicks "Send Confirmation Email" | `buildConfirmEmail()` |
| Booking decline | Admin clicks "Decline" | `buildDeclineEmail()` |
| Magic login link | Guest requests login | inline in `handleGuestLogin()` |
| Contract delivery | Guest signs contract | `buildContractEmail()` / `buildColtContractEmail()` |
| Admin new enquiry alert | Guest submits enquiry form | `buildAdminAlertEmail()` |
| Direct booking confirmation | Guest completes booking form | `buildDirectBookingGuestEmail()` |
| Payment reminder | Daily cron job (1am UTC) | inline in cron handler |

The confirmation email includes:
- Room + prorated estimated total (auto-calculated)
- Check-in / check-out dates
- Monthly rent + deposit breakdown (USD and VND)
- Stripe payment links (USD and VND)
- Inline rental agreement terms
- Guest portal link

---

## Deployment

### Automatic (production)
Every push to `main` triggers GitHub Actions → deploys via `wrangler deploy` to production.

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
```

Secrets required in GitHub Actions:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Manual
```bash
npx wrangler deploy
```

### Secrets (set once via CLI, never committed)
```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_SECRET
```

---

## Critical Configuration Rules

> These constraints have caused production outages when violated. Read carefully.

1. **Do NOT add `html_handling = "none"` to `wrangler.toml`** — This disables Cloudflare's automatic `.html` routing, causing the entire site (landing, admin, guest) to return 404.

2. **Do NOT add `binding = "ASSETS"` to `wrangler.toml`** — This switches from automatic to manual asset serving mode and similarly breaks the site.

3. **Never commit `RESEND_API_KEY` or `ADMIN_SECRET`** to source code. They are Cloudflare Worker secrets and must be set via `wrangler secret put`.

4. **The `/guest` route uses a 302 redirect** (not 301) to `/guest.html`. This ensures browsers always re-check rather than serving a permanently cached redirect, which is critical because the query string (`?id=...`) must be preserved.

5. **`_headers` file** in `/public` sets `Cache-Control: no-cache, must-revalidate` on all `.html` files. This prevents CDN/browser caching of stale portal versions after deployments.

---

## Multi-Property Support

The system is architected for multiple properties from the start. Every API endpoint accepts a `propertyId` parameter (defaults to `"ta-garden"`). KV keys are namespaced by property (e.g., `enquiries__{propertyId}`).

To add a second property:
1. Create it in the admin dashboard (Properties tab)
2. Use the property selector dropdown in the admin header to switch between properties
3. The same worker, KV namespace, and deployment serve all properties

---

## Guest Lifecycle (End-to-End)

```
1. Guest fills enquiry form on landing page
   → POST /api/enquire
   → Enquiry saved to KV with status "pending"
   → Admin receives alert email

2. Admin reviews enquiry in admin portal
   → Sets room rates, dates, deposit
   → Clicks "Send Confirmation Email"
   → POST /api/admin/notify (action: "confirm")
   → Status set to "confirmed", rates saved
   → Guest receives confirmation email with Stripe payment links + guest portal link

3. Guest pays deposit via Stripe
   → Admin marks "Payment Received" in onboarding checklist
   → PATCH /api/admin/onboarding

4. Guest opens portal link (/guest.html?id=...)
   → Completes guest profile (passport, address, emergency contacts)
   → Uploads passport photo + visa document
   → Reviews and e-signs rental agreement
   → Admin receives signed contract via email

5. Admin sends contract to guest
   → POST /api/admin/notify (action: "send-contract")
   → Guest receives countersigned contract PDF

6. Monthly payment reminders
   → Cron job runs daily at 1am UTC
   → Sends reminders X days before each monthly due date

7. Admin records ongoing payments
   → POST /api/admin/payment
   → Visible in guest profile payment history

8. Electricity billing
   → Admin posts monthly electricity bill
   → POST /api/admin/electricity
   → Visible in guest portal

9. Check-out
   → Admin archives the enquiry
```

---

## Admin Portal Features

| Feature | Description |
|---|---|
| Enquiry board | Card/list view of all enquiries with status, room, dates, financials |
| Guest profile modal | Full guest detail view with all sections below |
| Financial summary | Monthly rent (USD+VND), security deposit, cost of stay (prorated) |
| Edit Dates | Update check-in/out; auto-regenerates rental contract |
| Edit Rates | Update monthly rent (USD+VND) and deposit; auto-regenerates contract |
| Send Updated Confirmation | Resend confirmation email after date/rate changes with live prorated preview |
| Onboarding checklist | Toggle: Payment Received, Contract Signed, Passport Uploaded, Visa Uploaded |
| Document upload | Upload/replace passport and visa photos from admin (base64, max 4MB) |
| Payment log | Record and delete payments; shows USD or VND totals |
| Electricity billing | Post/delete electricity bills with VND→USD conversion |
| Activity log | Timestamped audit trail of all changes per enquiry |
| Contract viewer | View/send the generated rental agreement |
| Guest portal link | Copy or open the permanent guest portal link |
| Restore guest portal | Re-create a missing enquiry by ID (for portal link recovery) |
| Calendar blocking | Block date ranges from showing as available |
| iCal sync | Import external calendar (Airbnb, etc.) to block dates |
| Direct booking | Create confirmed booking directly from admin |
| Booking links | Generate shareable pre-filled booking forms with expiry |
| Room availability grid | Visual overview of which rooms are occupied/available |
| Multi-property switcher | Dropdown to manage multiple properties in one dashboard |
| Archive/restore | Soft-delete enquiries without losing data |

---

## Scaling Considerations

### Near-term improvements
- **Stripe webhooks** — Automatically mark "Payment Received" when Stripe confirms payment, eliminating the manual toggle
- **WhatsApp notifications** — Send booking confirmations and reminders via WhatsApp Business API (Twilio or Meta direct) for the Vietnamese market
- **Email open/click tracking** — Resend supports webhooks; could surface delivery status in admin
- **Calendar write-back** — After confirming a booking, auto-push to Google Calendar via API

### Medium-term
- **Occupancy dashboard** — Revenue per room, occupancy rate, average stay length — KV data is already structured for this
- **Guest-facing payment portal** — Let guests see their payment history and upcoming dues in the guest portal
- **Automated contract resend** — Trigger contract delivery automatically when "Payment Received" is toggled
- **Multi-currency Stripe** — Currently USD and VND Stripe links are static; could generate dynamic per-booking payment links via Stripe API

### Architectural evolution
- **D1 (SQLite on Cloudflare)** — If querying gets complex (reporting, search, filtering), migrating from KV to D1 would allow SQL queries. The data model maps cleanly to relational tables.
- **R2 (Object Storage)** — Passport/visa photos are currently stored as base64 in KV (max 25MB per KV value). For scale, move documents to Cloudflare R2 and store only the R2 key in KV.
- **Multiple properties** — Already supported. To onboard a new property: create via admin, assign a `propertyId`, use the same deployment.
- **White-label** — The codebase is designed around `propertyId` and `propertyName` throughout; rebranding for a second operator requires only changing copy and CSS variables.

---

## Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| KV is eventually consistent | Rare edge case: two rapid writes could conflict | Acceptable for this use case; single admin user |
| Base64 document storage in KV | Max ~4MB per document; stored inline | Fine for current scale; migrate to R2 for growth |
| No pagination on enquiry list | Performance degrades with 200+ enquiries | KV list is sliced to 200; add pagination if needed |
| Admin is single-user | No role-based access, no audit of who did what | Single operator; add JWT-based multi-user if needed |
| Stripe links are static | Can't generate per-booking amounts | Fine with manual deposit collection; Stripe API for dynamic links |

---

## Local Development

```bash
# Install dependencies
npm install

# Run locally (uses remote KV by default)
npx wrangler dev

# Deploy to production
npx wrangler deploy
```

No environment file needed — secrets are pulled from Cloudflare. For local testing with real KV data, `wrangler dev` connects to the remote KV namespace by default.

---

## Environment & Secrets Reference

| Secret | Where set | Description |
|---|---|---|
| `RESEND_API_KEY` | Cloudflare Worker secrets | Resend API key for sending emails |
| `ADMIN_SECRET` | Cloudflare Worker secrets | Shared secret for admin portal auth |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secrets | For CI/CD deployment |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets | For CI/CD deployment |

KV Namespace:
- **Binding name:** `BOOKINGS`
- **Namespace ID:** `8d5879ddbfb64e4ca94643fa844645fd`

---

## Session Notes for Engineers

- The entire system has no npm dependencies beyond `wrangler` (dev only). `worker.js` is plain ES2022 with no imports.
- All HTML files are self-contained with inline CSS and JS — no external bundling.
- The admin portal loads all enquiries into a client-side `allEnquiries` array on page load and mutates it in-place after each API call to avoid re-fetches.
- Contract HTML is pre-generated and stored in KV at confirmation time, then re-generated whenever dates or rates are updated. This ensures the contract always reflects the agreed terms at signing time.
- The `_headers` file must stay in `/public` — it prevents Cloudflare's CDN from caching stale HTML after deployments.
- All financial calculations (prorated rent, cost of stay) use the formula `Math.round((days/30) * 10) / 10 * monthlyRate` — rounding to 1 decimal month. This is consistent across worker.js, admin.html, and guest.html.
