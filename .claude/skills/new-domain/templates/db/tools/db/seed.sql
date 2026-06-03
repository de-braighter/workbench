-- Idempotent seed for the {{DOMAIN}} domain plan tree root.
-- Column is `kind` (not `type`). Root node requires tree_root_id = id.
-- title and created_by are NOT NULL (no default); use sentinel values for this
-- degenerate plan-tree root that exists only to anchor inference posteriors.
INSERT INTO kernel.plan_node (id, tenant_pack_id, tree_root_id, parent_id, kind, ordinal, title, created_by, effects)
VALUES (
  '20000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4001-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  NULL,
  '{{DOMAIN}}.world',
  0,
  '{{DOMAIN_PASCAL}} world root',
  '00000000-0000-0000-0000-000000000000'::uuid,
  '[]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
