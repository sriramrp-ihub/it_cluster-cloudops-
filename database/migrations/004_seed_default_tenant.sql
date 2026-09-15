-- CloudOps Migration 004: Seed Default Tenant for Development & UI Onboarding
-- Inserts a default development tenant so local dev and web UI (/onboarding) works immediately.

INSERT INTO tenants (id, name)
VALUES ('ten_default_tenant', 'Default Development Tenant')
ON CONFLICT (id) DO NOTHING;
