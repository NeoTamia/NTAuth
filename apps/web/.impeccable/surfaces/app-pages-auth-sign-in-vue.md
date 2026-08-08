---
version: 1
slug: "app-pages-auth-sign-in-vue"
primary_target: "app/pages/auth/sign-in.vue"
related_targets:
  [
    "app/pages/auth/forgot-password.vue",
    "app/pages/auth/reset-password.vue",
    "app/pages/auth/accept-invitation.vue",
    "app/layouts/admin.vue",
    "app/pages/admin/security/mfa.vue",
    "app/pages/admin/oauth-clients.vue",
    "app/pages/admin/organizations.vue",
    "app/pages/admin/policies.vue",
    "app/pages/admin/users.vue",
    "app/pages/admin/service-grants.vue",
    "app/pages/admin/audit-events.vue",
  ]
---

## Scope and mode

Operate flow covering sign-in, password recovery, password reset, invitation acceptance, sign-out,
MFA enrollment, the MFA-gated OAuth client registry, tenant administration, policy editing,
platform user administration, organization-scoped service grants, and authorized audit review.

## Audience and job

Invited NeoTamia users need to regain an authenticated session safely, understand
expired or invalid recovery states, and return only to a local protected route.

## Task and content

The surface presents a persistent access-path register beside one active form.
It explains invitation-only accounts, 12-character password requirements,
anti-enumeration behavior and session revocation after reset without exposing
identity existence.

Administrators also navigate an isolated tenant register, unlock identity details
with a fresh MFA challenge, and manage organization state, memberships and
invitations without losing the last active administrator.

Policy authors work inside an explicit tenant and service scope, move between a
structured statement editor and lossless JSON, and review validation, differences
and immutable version hashes before an audited write.

Platform administrators search a paginated identity register, inspect only
minimized session metadata, and confirm session revocation or lifecycle changes
inside one clearly identified user scope.

Organization administrators choose an explicit tenant, service and active member,
then prepare activation, suspension or terminal revocation with a fresh challenge
and a readable scope summary.

Audit readers search one authorized organization or global service scope, move
through stable cursor pages, inspect only allowlisted metadata, and explicitly
confirm a masked CSV export.

## Constraints

Preserve the incumbent light mineral palette, forest green actions, rust focus
accent, system type and public shell. Keyboard, screen reader and mobile paths are
first-class. Server session state and API responses remain authoritative.

## Direction and memorable moment

Candidate 4, seed 867fee6a: a two-zone access register. The left rail makes the
available recovery paths and security guarantees legible; the right work area
holds exactly one task and visibly transitions between idle, loading, error and
success. On mobile the register becomes a compact preface above the task.

## Unresolved decisions

No final NeoTamia logo asset or custom typeface exists; do not fabricate either.
