-- ===========================================================================
-- ByteMe — grant_demo_factory_access.sql
--
-- The API only lists factories whose id is in the signed-in user's
-- app_metadata.factory_ids (or users with app_metadata.byteme_admin = true).
-- After running seed_demo_factories.sql, run this once in the Supabase SQL editor
-- to add the demo factories to ONE user's grants. Existing grants are kept.
--
-- 1. Replace YOUR_EMAIL_HERE with the email you sign in with.
-- 2. Run it.
-- 3. Sign out of the ByteMe app and sign in again so the new grants reach the token.
-- ===========================================================================

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
  'factory_ids',
  (
    select coalesce(jsonb_agg(distinct grant_id), '[]'::jsonb)
    from (
      select jsonb_array_elements_text(coalesce(u.raw_app_meta_data -> 'factory_ids', '[]'::jsonb)) as grant_id
      union
      select f.id::text
      from public.factories f
      where f.slug in (
        'demo-chocolate-factory',
        'demo-cosmetics-factory',
        'demo-food-factory',
        'demo-beverage-factory',
        'demo-pharmaceutical-factory',
        'demo-automotive-factory',
        'demo-furniture-factory'
      )
    ) grants
  )
)
where u.email = 'YOUR_EMAIL_HERE';

-- Check the result (should list every demo factory id):
select email, raw_app_meta_data -> 'factory_ids' as factory_ids
from auth.users
where email = 'YOUR_EMAIL_HERE';
