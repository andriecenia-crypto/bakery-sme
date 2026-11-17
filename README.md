# Crust & Crumb Bakery

A warm, artisan-boutique web app for local bakeries: customers browse the menu, personalise
items (cake messages!), pre-order for pickup and track status live; bakers manage products,
the daily baking schedule, demand forecasts and order fulfilment.

**Stack:** HTML/CSS/vanilla JS + Supabase JS SDK (frontend) · Flask + `supabase-py` (backend) · Supabase PostgreSQL · Render deploy.

## Project layout

```
crust_and_crumb/
├── backend/            Flask API (also serves the static frontend)
│   ├── app.py          app factory, /api/config, error handling
│   ├── config.py       env config, Supabase client, auth decorators
│   ├── routes/         auth, products, orders, admin (+ baking schedule, forecast)
│   └── services/       notification_service.py
├── database/           schema.sql (7 tables + RLS + realtime), seed.sql
├── frontend/           index, login, register, dashboard (customer), admin (baker)
├── render.yaml  requirements.txt  .env.example  .gitignore
```

## 1. Set up Supabase

1. Create a project at <https://supabase.com>.
2. **SQL Editor** → run `database/schema.sql`, then `database/seed.sql`.
3. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.
4. *(Optional, for quick testing)* **Authentication → Providers → Email**: turn off
   "Confirm email" so sign-ups can log in immediately.
5. **Authentication → URL Configuration**: add your site URL (e.g. `http://localhost:5000`
   and your Render URL) so confirmation emails redirect correctly.

## 2. Run locally

```bash
cd crust_and_crumb
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # then fill in your three Supabase values
python -m backend.app
```

Open <http://localhost:5000>.

## 3. Create your first admin

Everyone who signs up is a `customer`. Register normally, then in the Supabase SQL editor:

```sql
update public.users set role = 'admin' where email = 'you@yourbakery.com';
```

Log in again — you'll be redirected to the **Baker dashboard**. Admins can promote bakers to
`staff` from the **Team** tab (staff manage orders, products and batches; only admins manage roles).

## 4. Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint**, select the repo (it reads `render.yaml`).
3. Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Deploy, then add the Render URL to Supabase's allowed redirect URLs.

## How it works

| Area | Behaviour |
| --- | --- |
| Auth | Supabase Auth in the browser (persistent session). A DB trigger creates the `users` profile (always `customer`). The browser sends its JWT to Flask, which verifies it. Role decides the redirect: customers → `dashboard.html`, staff/admin → `admin.html`. |
| Catalog | `index.html` reads `categories` and `products` directly through the Supabase SDK (public read RLS) and overlays live availability from `/api/products/availability`. |
| Availability | If a product has a baking batch for the day, remaining = batch target − pre-ordered quantity. Otherwise it is "made to order" with its prep-time notice. |
| Ordering | `POST /api/orders` re-prices items from the DB, enforces prep lead time, bakery hours and stock, then creates the order and notifies the customer and staff. |
| Live tracking | The customer dashboard subscribes to Supabase Realtime on `orders` and `bakery_notifications` (with a 45 s polling fallback). |
| Forecasting | `/api/admin/forecast` suggests a bake quantity per product: max(pre-orders, 14-day average demand × 1.15). One click creates the missing batches. |
| Security | All writes go through Flask with the service-role key after role checks; browser RLS is read-only and scoped to the owner/staff. Prices are never trusted from the client. |

## API summary

| Method & path | Access | Purpose |
| --- | --- | --- |
| `GET /api/config` | public | Supabase URL + anon key for the browser |
| `GET /api/auth/me`, `PUT /api/auth/me` | user | Profile |
| `GET /api/auth/notifications`, `POST …/read` | user | In-app notifications |
| `GET /api/products`, `/categories`, `/availability?date=` | public | Catalog |
| `POST/PUT/DELETE /api/products[/id]` | staff | Product CRUD |
| `POST /api/orders`, `GET /api/orders/mine`, `GET /api/orders/<id>`, `POST /api/orders/<id>/cancel` | customer | Ordering |
| `GET /api/admin/stats`, `GET /api/admin/orders`, `PATCH /api/admin/orders/<id>` | staff | Fulfilment |
| `GET/POST/PUT/DELETE /api/admin/batches`, `POST /api/admin/batches/generate`, `GET /api/admin/forecast` | staff | Baking schedule & forecast |
| `GET /api/admin/users`, `PATCH /api/admin/users/<id>/role` | admin | Team roles |

## Notes

- Images are loaded from Unsplash; a built-in placeholder appears if one is unreachable. Replace
  them with your own photos via the product editor.
- Stock checks run at order time; two simultaneous orders for the very last item could both pass.
  For high volume, move the check into a database function.
- Payments are collected at pickup; staff mark orders as paid.
