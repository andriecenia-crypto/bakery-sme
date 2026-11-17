-- =====================================================================
-- Crust & Crumb Bakery — Supabase (PostgreSQL) schema
-- Run this whole file in the Supabase SQL editor (Dashboard → SQL).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. users (profile table linked to Supabase auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null default '',
  role        text not null default 'customer'
              check (role in ('admin', 'staff', 'customer')),
  phone       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_users_role on public.users (role);

-- ---------------------------------------------------------------------
-- 2. categories
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. products
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid references public.categories (id) on delete set null,
  name            text not null unique,
  description     text,
  price           numeric(10, 2) not null check (price >= 0),
  prep_time_hours integer not null default 0 check (prep_time_hours >= 0),
  image_url       text,
  is_featured     boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists idx_products_category on public.products (category_id);
create index if not exists idx_products_featured on public.products (is_featured);

-- ---------------------------------------------------------------------
-- 4. baking_batches
-- ---------------------------------------------------------------------
create table if not exists public.baking_batches (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  batch_date      date not null,
  target_quantity integer not null check (target_quantity > 0),
  actual_baked    integer not null default 0 check (actual_baked >= 0),
  status          text not null default 'scheduled'
                  check (status in ('scheduled', 'baking', 'completed')),
  created_at      timestamptz not null default now(),
  unique (product_id, batch_date)
);
create index if not exists idx_batches_date on public.baking_batches (batch_date);
create index if not exists idx_batches_product on public.baking_batches (product_id);

-- ---------------------------------------------------------------------
-- 5. orders
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.users (id) on delete cascade,
  total_amount       numeric(10, 2) not null default 0 check (total_amount >= 0),
  pickup_date        date not null,
  pickup_time        time not null default '09:00',
  fulfillment_status text not null default 'received'
                     check (fulfillment_status in
                       ('received', 'baking', 'ready_for_pickup', 'completed', 'cancelled')),
  payment_status     text not null default 'unpaid'
                     check (payment_status in ('unpaid', 'paid')),
  created_at         timestamptz not null default now()
);
create index if not exists idx_orders_customer on public.orders (customer_id);
create index if not exists idx_orders_pickup on public.orders (pickup_date);
create index if not exists idx_orders_status on public.orders (fulfillment_status);

-- ---------------------------------------------------------------------
-- 6. order_items
-- ---------------------------------------------------------------------
create table if not exists public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  product_id          uuid not null references public.products (id) on delete restrict,
  quantity            integer not null check (quantity > 0),
  customization_notes text,
  unit_price          numeric(10, 2) not null check (unit_price >= 0),
  created_at          timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_product on public.order_items (product_id);

-- ---------------------------------------------------------------------
-- 7. bakery_notifications
-- ---------------------------------------------------------------------
create table if not exists public.bakery_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  message    text not null,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user
  on public.bakery_notifications (user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- Auto-create a profile row whenever someone signs up with Supabase Auth.
-- The role is ALWAYS 'customer'; promote staff/admin manually (see README).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by RLS policies (security definer avoids policy recursion).
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin', 'staff')
  );
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- The Flask backend uses the service-role key (bypasses RLS) for all
-- writes. The browser (anon/authenticated key) can only READ what is
-- allowed below.
-- ---------------------------------------------------------------------
alter table public.users                enable row level security;
alter table public.categories           enable row level security;
alter table public.products             enable row level security;
alter table public.baking_batches       enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.bakery_notifications enable row level security;

drop policy if exists "users read own or staff"     on public.users;
drop policy if exists "categories public read"      on public.categories;
drop policy if exists "products public read"        on public.products;
drop policy if exists "batches staff read"          on public.baking_batches;
drop policy if exists "orders read own or staff"    on public.orders;
drop policy if exists "order_items read own/staff"  on public.order_items;
drop policy if exists "notifications read own"      on public.bakery_notifications;
drop policy if exists "notifications update own"    on public.bakery_notifications;

create policy "users read own or staff" on public.users
  for select using (id = auth.uid() or public.is_staff());

create policy "categories public read" on public.categories
  for select using (true);

create policy "products public read" on public.products
  for select using (true);

create policy "batches staff read" on public.baking_batches
  for select using (public.is_staff());

create policy "orders read own or staff" on public.orders
  for select using (customer_id = auth.uid() or public.is_staff());

create policy "order_items read own/staff" on public.order_items
  for select using (
    public.is_staff() or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.customer_id = auth.uid()
    )
  );

create policy "notifications read own" on public.bakery_notifications
  for select using (user_id = auth.uid());

create policy "notifications update own" on public.bakery_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime (live pickup status + notifications in the browser)
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.bakery_notifications;
  exception when duplicate_object then null;
  end;
end;
$$;
