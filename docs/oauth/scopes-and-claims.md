# OAuth scopes and claims

NTAuth V1 exposes a closed scope catalogue. Clients can receive only the intersection of this catalogue, their registered scopes, and the scopes approved by the user. Unknown scopes and scope escalation during refresh are protocol errors.

| Scope            | Purpose                                    | Additional claims                                                 |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `openid`         | Identify the global NTAuth user            | `sub`                                                             |
| `profile`        | Display the user name                      | `name`                                                            |
| `email`          | Use the verified address                   | `email`, `email_verified`                                         |
| `offline_access` | Issue a refresh-token family after consent | None                                                              |
| `ntscout:access` | Access NTScout for the bound organization  | `organization_id`, `service`, `policies_etag` in its access token |

Access tokens use only `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `organization_id`, `service`, `scope`, and `policies_etag`. ID tokens and userinfo add profile or email data only when their corresponding scopes were granted. Client metadata, organization metadata, roles, policy documents, and internal database fields are never copied into a token.

The `organization_id` is derived from the server-validated authorization context. `service` is derived from the registered client contract, and `policies_etag` identifies the effective policy snapshot; none of these claims accept arbitrary request values.
