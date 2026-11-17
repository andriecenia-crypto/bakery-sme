-- =====================================================================
-- Crust & Crumb Bakery — seed data (run AFTER schema.sql)
-- Safe to re-run: uses ON CONFLICT DO NOTHING.
-- =====================================================================

insert into public.categories (name, slug, description) values
  ('Artisan Breads', 'artisan-breads',  'Slow-fermented loaves baked fresh every morning.'),
  ('Viennoiserie',   'viennoiserie',    'Buttery, flaky croissants and laminated pastries.'),
  ('Custom Cakes',   'custom-cakes',    'Celebration cakes made to order with your personal message.'),
  ('Gluten-Free',    'gluten-free',     'Thoughtfully baked treats without gluten.')
on conflict (slug) do nothing;

insert into public.products
  (category_id, name, description, price, prep_time_hours, image_url, is_featured)
values
  ((select id from public.categories where slug = 'artisan-breads'),
   'Country Sourdough Boule',
   'Naturally leavened for 24 hours with a crackling crust and tangy, open crumb.',
   260.00, 0,
   'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80', true),

  ((select id from public.categories where slug = 'artisan-breads'),
   'Rustic Wheat Loaf',
   'Stone-ground whole wheat and honey, perfect for toast and sandwiches.',
   220.00, 0,
   'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=80', false),

  ((select id from public.categories where slug = 'artisan-breads'),
   'Seeded Multigrain Batard',
   'Sunflower, flax and sesame seeds folded into a hearty, nutty dough.',
   285.00, 0,
   'https://images.unsplash.com/photo-1530610476181-d83430b64dcd?auto=format&fit=crop&w=900&q=80', false),

  ((select id from public.categories where slug = 'viennoiserie'),
   'Butter Croissant',
   'Seventy-two layers of cultured butter, golden and shatteringly crisp.',
   130.00, 0,
   'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=80', true),

  ((select id from public.categories where slug = 'viennoiserie'),
   'Almond Croissant',
   'Twice-baked croissant filled with frangipane and topped with toasted almonds.',
   165.00, 0,
   'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=900&q=80', false),

  ((select id from public.categories where slug = 'viennoiserie'),
   'Pain au Chocolat',
   'Laminated dough wrapped around two bars of dark Belgian chocolate.',
   150.00, 0,
   'https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?auto=format&fit=crop&w=900&q=80', false),

  ((select id from public.categories where slug = 'custom-cakes'),
   'Dark Chocolate Celebration Cake',
   'Three layers of moist cocoa sponge and silky ganache. Add your personal message!',
   1450.00, 48,
   'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80', true),

  ((select id from public.categories where slug = 'custom-cakes'),
   'Vanilla Bean Layer Cake',
   'Light vanilla sponge, mascarpone cream and seasonal fruit. Fully customizable.',
   1250.00, 48,
   'https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=900&q=80', true),

  ((select id from public.categories where slug = 'custom-cakes'),
   'Mini Cupcake Box (12)',
   'A dozen mini cupcakes in assorted flavors, topped with swirls of buttercream.',
   540.00, 24,
   'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=900&q=80', false),

  ((select id from public.categories where slug = 'gluten-free'),
   'Gluten-Free Seed Loaf',
   'Dense, moist and packed with seeds; made with buckwheat and brown rice flour.',
   310.00, 12,
   'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=80', false),

  ((select id from public.categories where slug = 'gluten-free'),
   'Flourless Chocolate Torte',
   'Rich, fudgy and naturally gluten-free. Served best slightly chilled.',
   890.00, 24,
   'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80', false)
on conflict (name) do nothing;

-- Baking schedule for today and tomorrow (gives the catalog live "left today" counts)
insert into public.baking_batches (product_id, batch_date, target_quantity, status)
select p.id, d.day, q.qty, 'scheduled'
from (values
  ('Country Sourdough Boule', 20),
  ('Rustic Wheat Loaf', 16),
  ('Seeded Multigrain Batard', 12),
  ('Butter Croissant', 48),
  ('Almond Croissant', 24),
  ('Pain au Chocolat', 30)
) as q(name, qty)
join public.products p on p.name = q.name
cross join (values (current_date), (current_date + 1)) as d(day)
on conflict (product_id, batch_date) do nothing;
