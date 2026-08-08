export { createDatabase, type DatabaseConnection } from "./client";
export {
  AUDIT_PAGE_MAX_SIZE,
  AUDIT_RETENTION_DAYS,
  AuditEventAuthorizationError,
  AuditEventInputError,
  decodeAuditCursor,
  encodeAuditCursor,
  exportIamAuditEvents,
  listIamAuditEvents,
  publicIamAuditMetadata,
  type IamAuditQuery,
  purgeExpiredAuditEvents,
} from "./audit-events";
export {
  completeEmailVerification,
  InvalidEmailVerificationError,
  requestEmailVerification,
} from "./email-verification";
export {
  calculateEffectivePolicyEtag,
  EffectivePolicyAuthorizationError,
  EffectivePolicyNotFoundError,
  getEffectivePolicies,
  mergeEffectivePolicies,
  type EffectivePolicyRow,
  type EffectivePolicyFingerprint,
} from "./effective-policies";
export { applyMigrations, rollbackLastMigration } from "./migrations";
export {
  addIamGroupMember,
  attachIamPolicy,
  createIamGroup,
  detachIamPolicy,
  IamAttachmentAuthorizationError,
  IamAttachmentConflictError,
  IamAttachmentNotFoundError,
  isOrganizationRole,
  listIamPolicyAttachments,
} from "./iam-attachments";
export {
  createIamCatalogEntry,
  createService,
  getServiceCatalogue,
  IamCatalogAuthorizationError,
  IamCatalogConflictError,
  IamCatalogNotFoundError,
  listAvailableServices,
  setIamCatalogEntryStatus,
  updateService,
} from "./iam-catalog";
export {
  createIamPolicy,
  createIamPolicyVersion,
  getIamPolicyHistory,
  hashPolicyDocument,
  IamPolicyAuthorizationError,
  IamPolicyConflictError,
  IamPolicyNotFoundError,
  IamPolicyValidationError,
  listIamPolicies,
  rollbackIamPolicy,
  setIamPolicyStatus,
} from "./iam-policies";
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
  getInvitationPreview,
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
  getOrganizationAdministration,
  listManagedOrganizations,
  OrganizationAuthorizationError,
  OrganizationConflictError,
  OrganizationNotFoundError,
  updateOrganization,
  updateOrganizationMember,
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
  getPlatformUserAdministration,
  InvalidUserLifecycleTransitionError,
  isUserActive,
  listPlatformUsers,
  permitsAuthentication,
  setUserStatus,
  UserLifecycleAuthorizationError,
  UserLifecycleNotFoundError,
  type ReversibleUserStatus,
} from "./user-lifecycle";
export * from "./schema";
