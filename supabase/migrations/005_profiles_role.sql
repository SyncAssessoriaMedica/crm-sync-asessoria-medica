-- Migration 005: add profiles.role
-- Safe and idempotent: can be run multiple times and works on existing databases.

-- Step 1: add column as nullable so no automatic default overwrites existing users.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role user_role;

-- Step 2: for users without a role yet, derive the best role from organization_members.
--   Priority: super_admin > gestor_sync > admin_clinica > atendente > leitura
UPDATE profiles p
SET    role = ranked.best_role
FROM (
  SELECT
    user_id,
    (ARRAY_AGG(
      role
      ORDER BY
        CASE role
          WHEN 'super_admin'   THEN 1
          WHEN 'gestor_sync'   THEN 2
          WHEN 'admin_clinica' THEN 3
          WHEN 'atendente'     THEN 4
          WHEN 'leitura'       THEN 5
          ELSE                      6
        END ASC
    ))[1] AS best_role
  FROM  organization_members
  GROUP BY user_id
) ranked
WHERE p.id = ranked.user_id
  AND p.role IS NULL;

-- Step 3: any profile still without a role (no membership row) gets the safe default.
UPDATE profiles SET role = 'atendente' WHERE role IS NULL;

-- Step 4: lock in the default for new rows.
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'atendente';

-- Step 5: enforce NOT NULL now that every row has a value.
ALTER TABLE profiles ALTER COLUMN role SET NOT NULL;
