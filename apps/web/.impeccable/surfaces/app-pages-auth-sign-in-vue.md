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
  ]
---

## Scope and mode

Operate flow covering sign-in, password recovery, password reset, invitation acceptance and sign-out.

## Audience and job

Invited NeoTamia users need to regain an authenticated session safely, understand
expired or invalid recovery states, and return only to a local protected route.

## Task and content

The surface presents a persistent access-path register beside one active form.
It explains invitation-only accounts, 12-character password requirements,
anti-enumeration behavior and session revocation after reset without exposing
identity existence.

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
