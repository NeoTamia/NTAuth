export { createDatabase, type DatabaseConnection } from "./client";
export {
  completeEmailVerification,
  InvalidEmailVerificationError,
  requestEmailVerification,
} from "./email-verification";
export { applyMigrations, rollbackLastMigration } from "./migrations";
export {
  createIamCatalogEntry,
  createService,
  getServiceCatalogue,
  IamCatalogAuthorizationError,
  IamCatalogConflictError,
  IamCatalogNotFoundError,
  setIamCatalogEntryStatus,
  updateService,
} from "./iam-catalog";
export {
  getNtscoutClient,
  NTSCOUT_CLIENT_ID,
  NTSCOUT_SCOPES,
  provisionNtscoutClient,
} from "./oauth-clients";
export {
  beginMfaEnrollment,
  encryptTotpSecret,
  enforcePlatformAdminMfa,
  generateTotpCode,
  generateTotpSecret,
  InvalidMfaChallengeError,
  MfaEnrollmentAuthorizationError,
  MfaEnrollmentRequiredError,
  totpCounter,
  verifyMfaEnrollment,
} from "./mfa";
export {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  generateInvitationToken,
  hashInvitationToken,
  InvalidInvitationError,
  InvitationAuthorizationError,
} from "./invitations";
export { transactWithEmail, type OutboxTransaction } from "./outbox";
export {
  changePassword,
  completePasswordReset,
  InvalidCurrentPasswordError,
  InvalidPasswordResetError,
  requestPasswordReset,
} from "./passwords";
export {
  addOrganizationMember,
  changeOrganizationMemberRole,
  createOrganization,
  OrganizationAuthorizationError,
} from "./organizations";
export { revokeUserSessions, SessionRevocationAuthorizationError } from "./sessions";
export {
  createServiceGrant,
  hasActiveServiceGrant,
  listServiceGrants,
  revokeServiceGrant,
  ServiceGrantAuthorizationError,
  ServiceGrantConflictError,
  ServiceGrantNotFoundError,
  setServiceGrantActive,
} from "./service-grants";
export {
  deleteUser,
  InvalidUserLifecycleTransitionError,
  isUserActive,
  permitsAuthentication,
  setUserStatus,
  UserLifecycleAuthorizationError,
  UserLifecycleNotFoundError,
  type ReversibleUserStatus,
} from "./user-lifecycle";
export * from "./schema";
