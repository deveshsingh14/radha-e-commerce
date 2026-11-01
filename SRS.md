# Software Requirements Specification (SRS)

## 1. Introduction
**Project name**: Radha E-Commerce (formerly "Radha Bangles & Jewellery")
**Live site**: https://deveshsingh14.github.io/radha-e-commerce/
**Repository**: `deveshsingh14/radha-e-commerce` (renamed from `project-dev-vat-non-prod-01` on 1 Nov 2026)
**Purpose**: The single blueprint of the product: what it does, how it is built and operated, and what changed. Update it whenever a feature, rule or setting changes (see §10 Change log).

The store sells everyday beauty, skincare, haircare, baby and women's-care products on the main storefront, and bridal jewellery and bangles on a dedicated **Jewellery & Bangles** page.

## 2. System Architecture
| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript; multi-page (store, jewellery, checkout, account, admin, delivery, password pages) with drawers/sheets; installable PWA | GitHub Pages (deployed by the "Deploy Frontend to GitHub Pages" workflow on every push to `main` that touches `Rajeshwari-Frontend/`) |
| Backend API | Node.js, Express 5 | Render web service `project-dev-vat-non-prod-01.onrender.com` (free plan per `render.yaml`; auto-deploys from `main`). The API address did not change with the repo rename. |
| Database | PostgreSQL via Prisma 6 | Neon (eu-west-2). Migrations applied manually (see §8.3). |
| Images | Cloudinary (uploads); served resized via URL transformations | Cloudinary CDN |
| Authentication | JWT (7-day tokens), bcrypt passwords, Google Sign-In | — |
| Email | Nodemailer (password reset) | SMTP account set via `EMAIL_*` |
| Push notifications | Web Push (VAPID) via `web-push` | Browser push services (FCM, Mozilla, Apple) |
| Error monitoring | Sentry: backend (`@sentry/node` 10) and browser (CDN bundle 10.76.0, SRI-pinned) | sentry.io |

Frontend modules (all in `Rajeshwari-Frontend/`): `api.js` (shared helpers, image sizing, logout hook), `store.js` (storefront), `section.js` (main vs jewellery split), `catalogue.js` (catalogue cache), `wishlist.js` (instant saves), `masonry.js` (feed layout), `pwa.js`, `notifications.js`, `monitoring.js`, `service-worker.js`, `checkout.js`, `account.js`, `admin.js`, `delivery.js`.

## 3. User Roles
1. **Customer**: browses, saves items, uses the cart, places and tracks orders, manages profile and notifications.
2. **Delivery Partner** (`DELIVERY_PARTNER`): assigned by an Admin from the Customers screen. Sees the delivery queue (orders ready to pick up plus their own), customer contact/address and cash to collect, and moves orders through delivery statuses. No access to the admin console. Redirected to the Deliveries page at login.
3. **Owner** (`OWNER`): admin console access for catalogue, categories, orders and delivery areas. No access to the Customers screen, role changes or account deletion (those are Admin-only).
4. **Admin** (`ADMIN`): full admin console including customer management and role changes.
5. **Master admin**: the Admin account whose email equals `ADMIN_EMAIL`. It cannot be demoted or deleted by other admins. It is resolved to one account id (exact email match first, otherwise the oldest matching ADMIN, ignoring case and spaces), so a look-alike registration is never protected. Shown as "Master admin" in the Customers list. The email is not exposed in public JavaScript.

## 4. Key Features & Requirements

### 4.1 Authentication & Authorization
- Email/password registration and login, plus **Google Sign-In** (client id served by `GET /auth/google-client-id`).
- **Password management**: change password when logged in; "Forgot password" emails a time-limited reset link to `…/radha-e-commerce/reset-password.html?token=…`, built from `FRONTEND_URL` (before 1 Nov 2026 the link pointed at the API host and did not work).
- **Role-based access**: admin routes need `ADMIN`/`OWNER` (role changes and customer deletion need `ADMIN`). Delivery routes need `DELIVERY_PARTNER`/`ADMIN`/`OWNER`, and the role is **re-checked in the database** on every delivery request, so a demoted partner loses access immediately even with an unexpired token.
- **Rate limits**: login 10 per 15 minutes, registration 5 per hour, forgot/reset password 5 per 15 minutes.
- **Logout** first unsubscribes the device from push notifications, so a shared device does not keep receiving the previous user's alerts. Then it clears the token.

### 4.2 User Profile
- Name, phone, address, city, state, pincode. Used to pre-fill checkout.
- "My profile" (account menu) opens the Profile tab directly (`account.html#profile`).

### 4.3 Catalogue
- **Products**: CRUD with title, description, price, stock, image (Cloudinary), keywords, multiple categories. CSV bulk upload.
- **Categories**: create, delete, and a **"Jewellery & Bangles page"** tick-box per category (`isJewellery`). Ticking moves the category, and any product in it, from the main store to the Jewellery page.
- Deleting a product **does not** remove it from past orders (see §6).

### 4.4 Storefront (shopping experience)
- **Two sections**:
  - **Main store** (`index.html`, "Radha E-Commerce"): everything except jewellery.
  - **Jewellery & Bangles** (`jewellery.html`): only products with at least one jewellery category.
  - A product is shown in exactly one section. Category chips that belong to the other section navigate there (`?category=…`).
- **Categories** are chosen from the round "story" circles, one at a time (deliberate: small catalogue, phone-first). "For You" / "All Jewellery" clears the filter. The duplicate chip row below the circles was removed.
- **Search**: within the current section (title, description, keywords, categories).
- **Sort**: Newest, Price low→high, Price high→low. The feed is a masonry layout that places each card in the shortest column, so **sorted order reads left→right, top→bottom** (phone 2 columns, tablet up to 3, desktop up to 5).
- **Product sheet**: details, stock state, "Add to cart", save heart, "More like this" (same section).
- **Saved items (wishlist)**:
  - **Instant:** the heart flips on tap and syncs in the background.
  - **Tap-safe:** any number of quick taps sends at most two requests and ends on the last tap's state.
  - **Failures:** the heart reverts with a message.
  - **Look:** outline heart when not saved, filled red when saved.
  - **Logged out:** a heart tap remembers that one item in the current tab only (sessionStorage, nothing sent to the server, expires in 30 minutes or when the login window is dismissed) and saves it right after login.
- **Cart** (shown to customers as "Cart"; the API keeps `/cart`): add, change quantity, remove; "Move to cart" from Saved.
- **Navigation**:
  - **Bottom bar (phones):** Home, Jewellery, Search, Saved, Cart.
  - **Top bar:** search, Saved, Cart, and a person icon that opens the **account menu** (My orders, My profile, Deliveries for partners, Install app when available, Log out). Logged out it shows "Log in". No hamburger menu (deliberate).
  - **Icons:** all from one inline SVG icon set (no emoji), identical on every device.

### 4.5 Checkout & Orders
- **Payment**: Cash on Delivery. UPI is prepared but disabled until a payment gateway is integrated; the server forces COD.
- **Delivery areas (pincode restriction)**:
  - **Admin setup:** admins turn the restriction on and list each serviceable pincode with **area, city and state** (Admin → Delivery areas). Rows without city/state are flagged.
  - **Customer choice:** when the restriction is on, customers pick from a **"Delivery area" dropdown** ("480884 — Area, City, State") instead of typing a pincode, with "Area not listed? We don't deliver there yet."
  - **Locked fields:** choosing an area fills the pincode and locks city/state.
  - **Saved pincodes:** the customer's saved pincode is pre-selected if it is listed, and explained if not. No area chosen means "Place order" is disabled.
  - **Server enforcement:** the server refuses unlisted pincodes and, when the pincode record has a city/state, stores **those** values on the order whatever the browser sent.
  - **Restriction off:** the normal pincode box is used.
  - **Public endpoint:** `GET /pincode-restrictions/areas` lists delivery areas while the restriction is on.
- **Order placement** runs in one transaction: re-read the cart, check stock, decrement stock, create the order (with a product title/image snapshot per line and the customer's email snapshot), clear the cart.
- **Order lifecycle** (single source: `src/utils/orderStatus.js`):
  - `Pending` → `Shipped` (admin) → `Out for Delivery` (delivery partner picks up) → `Delivered` or `Attempted`.
  - `Attempted` → `Out for Delivery` (retry).
  - `Cancelled` (admin; restocks, and un-cancelling re-checks stock).
  - Moving an order back to Pending/Shipped releases its delivery partner.
  - A cash-on-delivery order marked Delivered records the cash as **Paid**.
- **Customer order tracking**: account page timeline Placed → Shipped → Out for delivery → Delivered, with a note for attempted deliveries.

### 4.6 Delivery Partner Portal (`delivery.html`)
- **Sections:** "My deliveries" (Out for Delivery / Attempted that I carry) and "Ready to pick up" (unassigned Shipped orders). Orphaned in-progress orders are also shown.
- **Each card:** customer name, tap-to-call phone, address with map link, items, cash to collect, and action buttons valid for the status.
- **Rules (server-enforced):**
  - Status steps can't be skipped.
  - Claiming is atomic, so two partners can't take the same order (409).
  - Only the assigned partner can mark Delivered/Attempted (staff can override).
  - Partners cannot set payment status other than via Delivered + COD.
- All customer-entered text is escaped (stored-XSS fix, 1 Nov 2026).

### 4.7 Order Notifications (Web Push)
- **Customers** are notified when their order is placed, shipped, out for delivery, attempted, delivered or cancelled (only when the status actually changes). They opt in on My account → Order notifications or after checkout.
- **Shop owner side:** every ADMIN/OWNER device with "🔔 New-order alerts" on (admin header) is notified of each new order.
- **Content:** notifications carry the first name only, order number and amount. They are tagged per order so updates replace each other, and tapping opens the right page.
- **Configuration:**
  - Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; disabled gracefully if unset.
  - Links are absolute when `FRONTEND_URL` is set.
  - Expired subscriptions (404/410) are removed automatically.
  - iPhone/iPad: works only after adding the site to the Home Screen (iOS 16.4+).

### 4.8 Installable App (PWA)
- **App name** "Radha E-Commerce"; **home-screen label "Radha"** (manifest `short_name`, iOS title).
- **Installing is always the user's choice** (browsers do not allow automatic install):
  - Android and desktop Chrome/Edge show the site's own "Install" card.
  - iOS shows "Share → Add to Home Screen" steps.
  - A permanent "Install app" entry sits on the account page and in the account menu.
- **Service worker** (current cache `v8`):
  - Pages, JS and CSS are network-first (fresh after a deploy, offline fallback).
  - Our images are cache-first.
  - API responses are never cached by the service worker.
  - An updated worker waits for the user to tap "Refresh" (no mid-checkout reloads).
  - Offline page for unvisited pages.
- **Manifest shortcuts**: Jewellery & Bangles, My orders, Saved items. Screenshots provide a richer install dialog.

### 4.9 Admin Console
- **Dashboard and reports**: revenue, order-status chart (full lifecycle), top products (deleted products grouped by their saved title), category sales. The "Customers" KPI counts customer accounts only.
- **Orders**: details, full-lifecycle status select and filter, payment status, CSV export. Orders of deleted customers show "Deleted account" with the saved email.
- **Customers**: list with spend and last order. Admins can change roles (Admin, Owner, Customer, Delivery partner; takes effect at the user's next login for the UI, immediately for delivery access) and delete accounts. Deleting a customer **keeps their orders** (see §6). The master admin cannot be changed. No inline script handlers (stored-XSS fix).
- **Categories**: create, delete, Jewellery tick-box.
- **Delivery areas**: restriction toggle; add, edit and remove pincodes with area/city/state.
- **New-order alerts**: push opt-in button in the header.

## 5. Non-Functional Requirements

### 5.1 Security & Privacy
- **Credentials and sessions:**
  - Passwords hashed with bcrypt.
  - JWT-protected routes; role checks per route; delivery role re-checked in the DB.
  - Required env vars are validated at boot: `DATABASE_URL`, `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. The process exits if any is missing.
- **Request handling:**
  - Request bodies validated with zod on new and changed routes.
  - CORS allows only `https://deveshsingh14.github.io`; with `NODE_ENV=production` local origins are refused.
- **Output safety:**
  - All user and catalogue data is HTML-escaped.
  - No inline event handlers built from data (customer names, category names, delivery data).
  - Option lists are built with `textContent`.
- **Monitoring privacy (Sentry):**
  - Request bodies, cookies, auth headers, query strings and password-reset tokens are never sent.
  - `sendDefaultPii` is off.
  - Browser reporting runs only on the live site, from our own scripts.
  - The browser SDK is integrity-pinned (SRI).
- **Secrets:** never committed; `.env` is git-ignored. `render.yaml` and `.env.example` hold placeholders only.

### 5.2 Performance
- **Product images:** requested from Cloudinary at display size with automatic format/quality (feed 600px, story 160px, similar 300px, sheet 1000px, thumbnails 200px). Measured on the live home page (first visit, phone): **14.2 MB → 0.64 MB**.
- **Catalogue cache:** the public catalogue (raw API rows, 24 h, versioned key; never cart/wishlist/user data) is shown instantly on repeat visits while fresh data loads. Repeat visit first product: **~3.7 s → ~0.33 s**.
- **Cold starts:** after 4 s without data the store shows "Waking the store up…" (Render free plan sleeps when idle); requests time out after 70 s with a "Try again" option.
- **Early connections:** `preconnect` to the API and Cloudinary.
- **Known structural latency:** Render runs in Oregon and Neon in London, so each API request takes ~0.5–1.3 s from India (see §9).

### 5.3 Accessibility & UX
- Icon-only buttons have labels.
- The heart uses `aria-pressed`.
- The account menu supports keyboard (arrows, Esc) and returns focus.
- Animations respect reduced-motion.
- Hover styles apply only on hover-capable devices (no "stuck" hover on phones).

### 5.4 Data Integrity
- Order history is never deleted by product or customer deletion (§6).
- Stock changes happen inside transactions.
- Notifications fire only after the database commit.

## 6. Data Model & Retention (Prisma, `Rajeshwari-Backend/prisma/schema.prisma`)
- **User**:
  - roles: CUSTOMER, DELIVERY_PARTNER, OWNER, ADMIN
  - profile and address fields, Google id, reset-token fields
- **Product**, **Category** (`isJewellery`), **ProductCategory**.
- **Cart**, **Wishlist**: deleted with the user or product.
- **Order**:
  - `userId` is **nullable**, ON DELETE SET NULL; `customerEmail` snapshot.
  - Delivery details (name, phone, address, city, state, pincode).
  - Status, payment method/status, `deliveryPartnerId` (SET NULL).
- **OrderItem**: `productId` **nullable** (ON DELETE SET NULL); `title`/`image` snapshot; quantity and price.
- **PushSubscription**: one row per opted-in device; deleted with the user.
- **PincodeRestriction** (single row, `enabled`); **ServiceablePincode** (`pincode`, `area`, `city`, `state`).

**Retention rule**: orders are business records. Deleting a product keeps its order lines (title/image/price snapshot). Deleting a customer keeps their orders, unlinked and labelled "Deleted account". Before 1 Nov 2026 both deletions cascaded; orders #1 and #8 lost a ₹299 line that way and it cannot be recovered.

## 7. API Overview (backend `Rajeshwari-Backend/src/routes`)
| Area | Endpoints (auth) |
|---|---|
| Auth | `POST /auth/register`, `/login`, `/google`, `/forgot-password`, `/reset-password/:token`, `/change-password` (auth); `GET /auth/google-client-id` |
| Users | `GET/PUT /users/me`; admin: `GET /users`, `PUT /users/:id/role`, `DELETE /users/:id`, `GET /users/:id/orders`, owner-promotion settings |
| Products / Categories | `GET /products`, `GET /products/:id`; admin: create/update/delete/upload/bulk-upload. `GET /categories`; admin: `POST`, `PATCH /categories/:id {isJewellery}`, `DELETE` |
| Cart / Wishlist | `/cart`, `/wishlist` (auth) |
| Orders | `POST /orders/checkout`, `GET /orders` (customer); `GET /orders/admin/all`, `PUT /orders/:id/status`, `PUT /orders/:id/payment` (admin/owner); `GET /orders/delivery`, `PATCH /orders/:id/delivery-status` (delivery) |
| Delivery areas | `GET /pincode-restrictions/areas` (public); admin: `GET /`, `PUT /toggle`, `POST /`, `PUT /:pincode`, `DELETE /:pincode` |
| Notifications | `GET /notifications/vapid-public-key` (public); `POST`/`DELETE /notifications/subscribe` (auth) |
| Health | `GET /health` (checks the database) |

## 8. Operations

### 8.1 Environment variables (Render → Environment; local `Rajeshwari-Backend/.env`, never committed)
| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon PostgreSQL connection |
| `JWT_SECRET` | yes | Signs login tokens |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | Image uploads |
| `NODE_ENV` | recommended (`production`) | Production CORS; Sentry environment |
| `ADMIN_EMAIL` | recommended | Master admin protection |
| `GOOGLE_CLIENT_ID` | for Google Sign-In | OAuth client |
| `EMAIL_USER`, `EMAIL_PASS` (+ optional `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`) | for password reset | SMTP |
| `FRONTEND_URL` | recommended | Absolute links in emails and notifications (`https://deveshsingh14.github.io/radha-e-commerce/`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | Web Push |
| `SENTRY_DSN` (+ optional `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`) | optional | Backend error monitoring (10% tracing by default) |
| `ENABLE_OWNER_PROMOTION` | optional (default on) | Allow promoting users to Owner |
| `ADMIN_PASSWORD` | script only | `resetAdminPassword.js` |
| `PORT`, `LOG_LEVEL` | optional | Server port; log level |

The browser Sentry DSN (a public key by design) lives in `Rajeshwari-Frontend/monitoring.js`; the Sentry project's Allowed Domains is set to `deveshsingh14.github.io`.

### 8.2 Delivery workflow
- **Branching:** one change per branch, merged with `--no-ff` into `main` and pushed. No pull requests (owner's choice). Commits are authored by Devesh Singh only.
- **Before pushing:** run unit tests, run end-to-end browser tests against a local backend and a local Docker database, then push.
- **After pushing:** watch "Backend CI" and "Deploy Frontend to GitHub Pages", wait for Render, then verify the live site.

### 8.3 Database migrations
- Render's build does **not** run migrations. Apply them with `npx prisma migrate deploy` (after `migrate status`) **before** pushing backend code that needs them; Prisma reads every column, so code first would break the live API.
- Migrations must be additive/backward-compatible.
- The full history replays on an empty database. The bridge migration `20260801000000_rename_tables_to_lowercase` recreates the old out-of-band table renames and untracked columns, and is a no-op on production.
- Backend CI rebuilds an empty database from all migrations and fails on any drift from `schema.prisma`.

### 8.4 Testing
- **Frontend:** `cd Rajeshwari-Frontend && npx jest` (199 tests at 1 Nov 2026).
- **Backend:** `cd Rajeshwari-Backend && npm test` (database-free unit and HTTP tests, ~123).
- **Database tests:** `npm run test:db` runs **only** against a local/CI database. `scripts/testDbSafety.js` aborts if `DATABASE_URL` is not localhost (added after a 31 Oct 2026 incident in which a test deleted all live users; restored from Neon point-in-time restore).
- **CI** (`.github/workflows/backend-ci.yml`): `npm ci`, `npm audit --audit-level=high`, unit tests; a separate `db-tests` job uses a throwaway Postgres container.
- **Recommendation:** point local `.env` at a Neon dev branch instead of production.

## 9. Known Limitations & Backlog
- **Cold starts:** Render free plan sleeps after ~15 minutes idle, so the first visitor waits ~30–60 s. Fix: Render Starter plan (~$7/month).
- **Distance:** Render (Oregon) and Neon (London) are far from Indian customers. Option: move both to Singapore (planned migration needed).
- **Payments:** UPI/online payment disabled until a gateway is integrated.
- **Lost order lines:** orders #1 and #8 lost a ₹299 line before the retention fix (unrecoverable).
- **Catalogue data to correct in admin:** "Designer Chura" is in Earrings with an earrings photo; "Oxidized Silver Kada" shows a Jhumka photo.
- **Categories:** single choice by design. Possible future filters: price range, in stock only.
- **Old address:** apps installed from the old address `…/project-dev-vat-non-prod-01/` no longer load (GitHub Pages does not redirect renamed project sites). An optional redirect kit is in `tools/old-url-redirect/`.

## 10. Change Log
| Date | Change |
|---|---|
| 31 Oct 2026 | Repo cleanup (committed logs, leftover files); backend `npm audit` fixed (0 vulnerabilities); PWA files moved to the site root so the app is installable. |
| 31 Oct 2026 | **Incident**: a test wiped live users/orders; restored via Neon point-in-time restore. Added the test-database guard, `npm test` / `test:db` split and the CI database job. |
| 31 Oct 2026 | PWA improvements (network-first updates, install button everywhere, update bar, shortcuts, screenshots). |
| 31 Oct 2026 | Jewellery & Bangles page with per-category tick-box; main store rebranded "Radha E-Commerce"; category-chip XSS fix. |
| 31 Oct 2026 | Web Push order notifications for customers and the shop owner. |
| 1 Nov 2026 | Home-screen label "Radha"; delivery partner portal made to work end to end (lifecycle, atomic claims, role re-check, XSS fixes); migration history repaired. |
| 1 Nov 2026 | Order history kept when products or customers are deleted (snapshots, SET NULL). |
| 1 Nov 2026 | Repo renamed to `radha-e-commerce`; `FRONTEND_URL`; password-reset link fixed. |
| 1 Nov 2026 | Speed: resized images, catalogue cache, cold-start notice; duplicate category row removed; master-admin protection by id; Sentry on backend and browser with privacy scrubbing. |
| 1 Nov 2026 | Instant, tap-safe save heart; save after login; one SVG icon set; "Bag" → "Cart"; account menu; sorted feed reads across rows; pincode area lock and delivery-area dropdown at checkout. |

---
*This document is a living blueprint. Update §4–§9 and add a §10 entry with every change.*
