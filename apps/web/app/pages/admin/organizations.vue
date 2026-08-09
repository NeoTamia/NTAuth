<script setup lang="ts">
import { authErrorMessage } from "~/utils/auth";
import {
  MEMBERSHIP_STATUSES,
  membershipStatusLabel,
  ORGANIZATION_ROLES,
  organizationRoleLabel,
  organizationSlug,
  type MembershipStatus,
  type OrganizationRole,
} from "~/utils/organizations";

definePageMeta({ layout: "admin" });
useHead({ title: "Organisations — NTAuth" });

type OrganizationStatus = "active" | "suspended";
type OrganizationSummary = {
  administratorCount: number;
  id: string;
  memberCount: number;
  name: string;
  slug: string;
  status: OrganizationStatus;
  updatedAt: string;
};
type OrganizationMember = {
  email: string;
  name: string;
  role: OrganizationRole;
  status: MembershipStatus;
  updatedAt: string;
  userId: string;
};
type OrganizationInvitation = {
  email: string;
  expiresAt: string;
  id: string;
  role: OrganizationRole;
};
type OrganizationDetail = {
  invitations: OrganizationInvitation[];
  members: OrganizationMember[];
  organization: Omit<OrganizationSummary, "administratorCount" | "memberCount">;
};

const { request } = useAuthApi();
const { challengeHeaders, challengeReady } = useMfaChallenge();
const organizations = ref<OrganizationSummary[]>([]);
const listState = ref<"locked" | "loading" | "ready" | "error" | "forbidden">("locked");
const listCode = ref("");
const listError = ref("");
const selectedSummary = ref<OrganizationSummary | null>(null);
const detail = ref<OrganizationDetail | null>(null);
const detailState = ref<"locked" | "loading" | "ready" | "error" | "forbidden">("locked");
const detailCode = ref("");
const detailError = ref("");

const createOpen = ref(false);
const createName = ref("");
const createSlug = ref("");
const createCode = ref("");
const createPending = ref(false);
const createError = ref("");
const createTitle = ref<HTMLElement | null>(null);

const editName = ref("");
const editStatus = ref<OrganizationStatus>("active");
const organizationCode = ref("");
const organizationPending = ref(false);
const organizationMessage = ref("");

const selectedMember = ref<OrganizationMember | null>(null);
const memberRole = ref<OrganizationRole>("member");
const memberStatus = ref<MembershipStatus>("active");
const memberCode = ref("");
const memberPending = ref(false);
const memberMessage = ref("");
const memberError = ref(false);

const invitationEmail = ref("");
const invitationRole = ref<OrganizationRole>("member");
const invitationCode = ref("");
const invitationPending = ref(false);
const invitationMessage = ref("");
const invitationError = ref(false);
const selectedInvitation = ref<OrganizationInvitation | null>(null);
const cancelCode = ref("");
const cancelPending = ref(false);
const confirmCancel = ref(false);
const cancelMessage = ref("");

const canCreate = computed(
  () =>
    createName.value.trim().length > 0 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(createSlug.value) &&
    challengeReady(createCode.value) &&
    !createPending.value,
);

watch(createName, (value, previousValue) => {
  if (!createSlug.value || createSlug.value === organizationSlug(previousValue ?? ""))
    createSlug.value = organizationSlug(value);
});

function safeError(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { code?: string };
    status?: number;
    statusCode?: number;
  };
  if (candidate.data?.code === "organization_conflict")
    return "Au moins un propriétaire ou administrateur actif doit rester dans l’organisation.";
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Le code MFA est invalide, expiré ou cette organisation ne vous est pas autorisée.";
  return authErrorMessage(error, fallback);
}

async function unlockOrganizations() {
  if (!challengeReady(listCode.value)) return;
  listState.value = "loading";
  listError.value = "";
  try {
    organizations.value =
      (await request<OrganizationSummary[]>("/api/v1/organizations", {
        headers: challengeHeaders(listCode.value),
      })) ?? [];
    listState.value = "ready";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    listState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    listError.value = safeError(error, "Les organisations ne peuvent pas être chargées.");
  } finally {
    listCode.value = "";
  }
}

function selectOrganization(organization: OrganizationSummary) {
  selectedSummary.value = organization;
  detail.value = null;
  detailState.value = "locked";
  detailCode.value = "";
  detailError.value = "";
  selectedMember.value = null;
  selectedInvitation.value = null;
}

async function loadDetail() {
  if (!selectedSummary.value || !challengeReady(detailCode.value)) return;
  detailState.value = "loading";
  detailError.value = "";
  try {
    detail.value = await request<OrganizationDetail>(
      `/api/v1/organizations/${selectedSummary.value.id}`,
      { headers: challengeHeaders(detailCode.value) },
    );
    editName.value = detail.value.organization.name;
    editStatus.value = detail.value.organization.status;
    detailState.value = "ready";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    detailState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    detailError.value = safeError(error, "Le détail de l’organisation ne peut pas être chargé.");
  } finally {
    detailCode.value = "";
  }
}

async function openCreation() {
  createOpen.value = true;
  createError.value = "";
  await nextTick();
  createTitle.value?.focus();
  createTitle.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createOrganizationEntry() {
  if (!canCreate.value) return;
  createPending.value = true;
  createError.value = "";
  try {
    const created = await request<OrganizationSummary>("/api/v1/organizations", {
      body: { name: createName.value.trim(), slug: createSlug.value },
      headers: challengeHeaders(createCode.value),
      method: "POST",
    });
    const summary = { ...created, administratorCount: 0, memberCount: 0 };
    organizations.value = [...organizations.value, summary].toSorted((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
    createName.value = "";
    createSlug.value = "";
    createOpen.value = false;
    selectOrganization(summary);
  } catch (error) {
    createError.value = safeError(error, "L’organisation n’a pas pu être créée.");
  } finally {
    createCode.value = "";
    createPending.value = false;
  }
}

async function saveOrganization() {
  if (!detail.value || !challengeReady(organizationCode.value) || organizationPending.value) return;
  organizationPending.value = true;
  organizationMessage.value = "";
  try {
    const updated = await request<OrganizationDetail["organization"]>(
      `/api/v1/organizations/${detail.value.organization.id}`,
      {
        body: { name: editName.value.trim(), status: editStatus.value },
        headers: challengeHeaders(organizationCode.value),
        method: "PATCH",
      },
    );
    detail.value.organization = updated;
    if (selectedSummary.value) Object.assign(selectedSummary.value, updated);
    organizationMessage.value = "Organisation mise à jour.";
  } catch (error) {
    organizationMessage.value = safeError(error, "L’organisation n’a pas pu être mise à jour.");
  } finally {
    organizationCode.value = "";
    organizationPending.value = false;
  }
}

function editMember(member: OrganizationMember) {
  selectedMember.value = member;
  memberRole.value = member.role;
  memberStatus.value = member.status;
  memberCode.value = "";
  memberMessage.value = "";
  memberError.value = false;
}

async function saveMember() {
  if (!detail.value || !selectedMember.value || !challengeReady(memberCode.value)) return;
  memberPending.value = true;
  memberMessage.value = "";
  memberError.value = false;
  try {
    const updated = await request<Pick<OrganizationMember, "role" | "status" | "updatedAt">>(
      `/api/v1/organizations/${detail.value.organization.id}/members/${selectedMember.value.userId}`,
      {
        body: { role: memberRole.value, status: memberStatus.value },
        headers: challengeHeaders(memberCode.value),
        method: "PATCH",
      },
    );
    Object.assign(selectedMember.value, updated);
    if (selectedSummary.value) {
      selectedSummary.value.memberCount = detail.value.members.length;
      selectedSummary.value.administratorCount = detail.value.members.filter(
        ({ role, status }) => status === "active" && (role === "owner" || role === "admin"),
      ).length;
    }
    memberMessage.value = "Membership mise à jour.";
  } catch (error) {
    memberError.value = true;
    memberMessage.value = safeError(error, "Le membership n’a pas pu être mis à jour.");
  } finally {
    memberCode.value = "";
    memberPending.value = false;
  }
}

async function inviteMember() {
  if (!detail.value || !challengeReady(invitationCode.value) || invitationPending.value) return;
  invitationPending.value = true;
  invitationMessage.value = "";
  invitationError.value = false;
  try {
    const created = await request<{ expiresAt: string; id: string }>("/api/v1/invitations", {
      body: {
        email: invitationEmail.value.trim(),
        organizationId: detail.value.organization.id,
        role: invitationRole.value,
      },
      headers: challengeHeaders(invitationCode.value),
      method: "POST",
    });
    detail.value.invitations.unshift({
      ...created,
      email: invitationEmail.value.trim().toLowerCase(),
      role: invitationRole.value,
    });
    invitationEmail.value = "";
    invitationMessage.value = "Invitation créée et placée dans la file d’envoi.";
  } catch (error) {
    invitationError.value = true;
    invitationMessage.value = safeError(error, "L’invitation n’a pas pu être créée.");
  } finally {
    invitationCode.value = "";
    invitationPending.value = false;
  }
}

function prepareCancellation(invitation: OrganizationInvitation) {
  selectedInvitation.value = invitation;
  cancelCode.value = "";
  confirmCancel.value = false;
  cancelMessage.value = "";
}

async function cancelInvitation() {
  if (
    !detail.value ||
    !selectedInvitation.value ||
    !confirmCancel.value ||
    !challengeReady(cancelCode.value)
  )
    return;
  cancelPending.value = true;
  cancelMessage.value = "";
  try {
    await request(`/api/v1/invitations/${selectedInvitation.value.id}`, {
      headers: challengeHeaders(cancelCode.value),
      method: "DELETE",
    });
    detail.value.invitations = detail.value.invitations.filter(
      ({ id }) => id !== selectedInvitation.value?.id,
    );
    selectedInvitation.value = null;
  } catch (error) {
    cancelMessage.value = safeError(error, "L’invitation n’a pas pu être annulée.");
  } finally {
    cancelCode.value = "";
    confirmCancel.value = false;
    cancelPending.value = false;
  }
}
</script>

<template>
  <section class="organization-admin" aria-labelledby="organizations-title">
    <header class="organization-admin__header">
      <div>
        <h1 id="organizations-title">Organisations et membres</h1>
        <p>Administrez chaque tenant sans exposer les membres d’une autre organisation.</p>
      </div>
      <button v-if="listState === 'ready'" type="button" @click="openCreation">
        Nouvelle organisation
      </button>
    </header>

    <dl class="security-scope" aria-label="Garanties de gestion des organisations">
      <div>
        <dt>Isolation</dt>
        <dd>Accès calculé et vérifié côté serveur pour chaque tenant</dd>
      </div>
      <div>
        <dt>Continuité</dt>
        <dd>Le dernier administrateur actif ne peut pas être retiré</dd>
      </div>
      <div>
        <dt>Traçabilité</dt>
        <dd>Consultations, invitations et changements sont audités</dd>
      </div>
    </dl>

    <section v-if="listState !== 'ready'" class="registry-gate" aria-labelledby="org-gate-title">
      <h2 id="org-gate-title">Ouvrir le registre protégé</h2>
      <p>Une session d’administration active protège la liste des tenants que vous administrez.</p>
      <form method="post" aria-describedby="org-gate-message" @submit.prevent="unlockOrganizations">
        <MfaCodeField
          id="organizations-list-code"
          v-model="listCode"
          :disabled="listState === 'loading'"
        />
        <p
          v-if="listError"
          id="org-gate-message"
          class="form-message form-message--error"
          role="alert"
        >
          {{ listError }}
        </p>
        <p v-else id="org-gate-message" class="form-guidance">
          Le code ne sera valable que pour cette consultation auditée.
        </p>
        <button
          type="submit"
          :disabled="!challengeReady(listCode) || listState === 'loading'"
          :aria-busy="listState === 'loading'"
        >
          {{ listState === "loading" ? "Ouverture…" : "Vérifier et ouvrir" }}
        </button>
      </form>
    </section>

    <template v-else>
      <div v-if="organizations.length" class="organization-workspace">
        <section aria-labelledby="organization-list-title">
          <h2 id="organization-list-title">Tenants administrables</h2>
          <ul class="organization-list">
            <li v-for="organization in organizations" :key="organization.id">
              <button
                type="button"
                :aria-current="selectedSummary?.id === organization.id ? 'true' : undefined"
                @click="selectOrganization(organization)"
              >
                <span>{{ organization.name }}</span>
                <small
                  >{{ organization.slug }} · {{ organization.memberCount }} membre{{
                    organization.memberCount > 1 ? "s" : ""
                  }}</small
                >
                <strong :class="{ 'state-text--suspended': organization.status === 'suspended' }">{{
                  organization.status === "active" ? "Actif" : "Suspendu"
                }}</strong>
              </button>
            </li>
          </ul>
        </section>

        <section
          v-if="selectedSummary"
          class="organization-detail"
          aria-labelledby="organization-detail-title"
        >
          <header>
            <div>
              <h2 id="organization-detail-title">{{ selectedSummary.name }}</h2>
              <code>{{ selectedSummary.slug }}</code>
            </div>
            <button type="button" class="text-button" @click="selectedSummary = null">
              Fermer
            </button>
          </header>

          <form
            v-if="detailState !== 'ready'"
            class="detail-gate"
            aria-describedby="detail-gate-message"
            method="post"
            @submit.prevent="loadDetail"
          >
            <p>
              Le détail contient des identités. Activez votre session d’administration pour
              l’afficher.
            </p>
            <MfaCodeField
              id="organization-detail-code"
              v-model="detailCode"
              :disabled="detailState === 'loading'"
            />
            <p
              v-if="detailError"
              id="detail-gate-message"
              class="form-message form-message--error"
              role="alert"
            >
              {{ detailError }}
            </p>
            <p v-else id="detail-gate-message" class="form-guidance">
              Portée : cette organisation, ses membres et ses invitations en attente.
            </p>
            <button
              type="submit"
              :disabled="!challengeReady(detailCode) || detailState === 'loading'"
              :aria-busy="detailState === 'loading'"
            >
              {{ detailState === "loading" ? "Chargement…" : "Afficher le détail" }}
            </button>
          </form>

          <template v-else-if="detail">
            <form
              class="organization-settings"
              aria-describedby="organization-update-message"
              method="post"
              @submit.prevent="saveOrganization"
            >
              <div class="field">
                <label for="organization-name">Nom</label
                ><input id="organization-name" v-model="editName" required maxlength="160" />
              </div>
              <div class="field">
                <label for="organization-status">État du tenant</label
                ><select id="organization-status" v-model="editStatus">
                  <option value="active">Actif</option>
                  <option value="suspended">Suspendu</option>
                </select>
              </div>
              <MfaCodeField
                id="organization-update-code"
                v-model="organizationCode"
                :disabled="organizationPending"
                label="Code MFA pour modifier ce tenant"
              />
              <p
                id="organization-update-message"
                :class="[
                  'form-message',
                  {
                    'form-message--error':
                      organizationMessage && organizationMessage !== 'Organisation mise à jour.',
                  },
                ]"
                aria-live="polite"
              >
                {{
                  organizationMessage || "Portée : nom et disponibilité du tenant. Action auditée."
                }}
              </p>
              <button
                type="submit"
                :disabled="
                  !editName.trim() || !challengeReady(organizationCode) || organizationPending
                "
              >
                {{ organizationPending ? "Enregistrement…" : "Enregistrer le tenant" }}
              </button>
            </form>

            <section class="member-section" aria-labelledby="members-title">
              <header>
                <h3 id="members-title">Membres</h3>
                <span
                  >{{ detail.members.length }} identité{{
                    detail.members.length > 1 ? "s" : ""
                  }}</span
                >
              </header>
              <ul class="member-list">
                <li v-for="member in detail.members" :key="member.userId">
                  <button
                    type="button"
                    :aria-current="selectedMember?.userId === member.userId ? 'true' : undefined"
                    @click="editMember(member)"
                  >
                    <span
                      ><strong>{{ member.name }}</strong
                      ><small>{{ member.email }}</small></span
                    >
                    <span
                      >{{ organizationRoleLabel(member.role)
                      }}<small>{{ membershipStatusLabel(member.status) }}</small></span
                    >
                  </button>
                </li>
              </ul>
              <form
                v-if="selectedMember"
                class="member-editor"
                aria-describedby="member-update-message"
                method="post"
                @submit.prevent="saveMember"
              >
                <h4>Modifier {{ selectedMember.name }}</h4>
                <div class="inline-fields">
                  <div class="field">
                    <label for="member-role">Rôle</label
                    ><select id="member-role" v-model="memberRole">
                      <option v-for="role in ORGANIZATION_ROLES" :key="role" :value="role">
                        {{ organizationRoleLabel(role) }}
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="member-status">État</label
                    ><select id="member-status" v-model="memberStatus">
                      <option v-for="status in MEMBERSHIP_STATUSES" :key="status" :value="status">
                        {{ membershipStatusLabel(status) }}
                      </option>
                    </select>
                  </div>
                </div>
                <MfaCodeField
                  id="member-update-code"
                  v-model="memberCode"
                  :disabled="memberPending"
                  label="Code MFA pour ce membership"
                />
                <p
                  id="member-update-message"
                  :class="['form-message', { 'form-message--error': memberError }]"
                  aria-live="polite"
                >
                  {{
                    memberMessage ||
                    "Portée : rôle et accès de cette seule identité. Le dernier administrateur est protégé."
                  }}
                </p>
                <button type="submit" :disabled="!challengeReady(memberCode) || memberPending">
                  {{ memberPending ? "Enregistrement…" : "Mettre à jour le membership" }}
                </button>
              </form>
            </section>

            <section class="invitation-section" aria-labelledby="invitations-title">
              <header>
                <h3 id="invitations-title">Invitations en attente</h3>
                <span>{{ detail.invitations.length }}</span>
              </header>
              <form
                class="invitation-form"
                aria-describedby="invitation-message"
                method="post"
                @submit.prevent="inviteMember"
              >
                <div class="inline-fields">
                  <div class="field">
                    <label for="invitation-email">Adresse e-mail</label
                    ><input
                      id="invitation-email"
                      v-model="invitationEmail"
                      required
                      type="email"
                      autocomplete="email"
                    />
                  </div>
                  <div class="field">
                    <label for="invitation-role">Rôle prévu</label
                    ><select id="invitation-role" v-model="invitationRole">
                      <option v-for="role in ORGANIZATION_ROLES" :key="role" :value="role">
                        {{ organizationRoleLabel(role) }}
                      </option>
                    </select>
                  </div>
                </div>
                <MfaCodeField
                  id="invitation-code"
                  v-model="invitationCode"
                  :disabled="invitationPending"
                  label="Code MFA pour inviter"
                />
                <p
                  id="invitation-message"
                  :class="['form-message', { 'form-message--error': invitationError }]"
                  aria-live="polite"
                >
                  {{
                    invitationMessage ||
                    "Portée : une invitation valable 72 heures pour ce tenant. Envoi et création audités."
                  }}
                </p>
                <button
                  type="submit"
                  :disabled="
                    !invitationEmail.trim() || !challengeReady(invitationCode) || invitationPending
                  "
                >
                  {{ invitationPending ? "Création…" : "Créer l’invitation" }}
                </button>
              </form>
              <p v-if="!detail.invitations.length" class="empty-line">
                Aucune invitation en attente.
              </p>
              <ul v-else class="invitation-list">
                <li v-for="invitation in detail.invitations" :key="invitation.id">
                  <span
                    ><strong>{{ invitation.email }}</strong
                    ><small
                      >{{ organizationRoleLabel(invitation.role) }} · expire le
                      {{ new Date(invitation.expiresAt).toLocaleDateString("fr-FR") }}</small
                    ></span
                  >
                  <button
                    type="button"
                    class="text-button"
                    @click="prepareCancellation(invitation)"
                  >
                    Annuler
                  </button>
                </li>
              </ul>
              <form
                v-if="selectedInvitation"
                class="cancel-invitation"
                aria-describedby="cancel-message"
                method="post"
                @submit.prevent="cancelInvitation"
              >
                <h4>Annuler l’invitation de {{ selectedInvitation.email }}</h4>
                <label class="destructive-confirmation"
                  ><input v-model="confirmCancel" type="checkbox" />Je confirme que ce lien
                  d’invitation doit devenir inutilisable.</label
                >
                <MfaCodeField
                  id="cancel-invitation-code"
                  v-model="cancelCode"
                  :disabled="cancelPending"
                  label="Code MFA pour annuler"
                />
                <p id="cancel-message" class="form-message form-message--error" aria-live="polite">
                  {{ cancelMessage }}
                </p>
                <button
                  type="submit"
                  class="danger-button"
                  :disabled="!confirmCancel || !challengeReady(cancelCode) || cancelPending"
                >
                  {{ cancelPending ? "Annulation…" : "Annuler définitivement l’invitation" }}
                </button>
              </form>
            </section>
          </template>
        </section>
        <aside v-else class="organization-detail organization-detail--empty">
          <p>Sélectionnez un tenant pour consulter sa portée et administrer ses accès.</p>
        </aside>
      </div>
      <div v-else class="empty-state">
        <h2>Aucune organisation administrable</h2>
        <p>
          Créez le premier tenant. Les memberships et invitations seront ensuite gérés dans son
          espace isolé.
        </p>
        <button type="button" @click="openCreation">Créer une organisation</button>
      </div>
    </template>

    <section
      v-if="createOpen"
      class="organization-creation"
      aria-labelledby="organization-create-title"
    >
      <header>
        <h2 id="organization-create-title" ref="createTitle" tabindex="-1">Créer un tenant</h2>
        <button type="button" class="text-button" @click="createOpen = false">Fermer</button>
      </header>
      <form
        aria-describedby="organization-create-message"
        method="post"
        @submit.prevent="createOrganizationEntry"
      >
        <div class="inline-fields">
          <div class="field">
            <label for="create-organization-name">Nom</label
            ><input id="create-organization-name" v-model="createName" required maxlength="160" />
          </div>
          <div class="field">
            <label for="create-organization-slug">Identifiant stable</label
            ><input
              id="create-organization-slug"
              v-model="createSlug"
              required
              maxlength="80"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
          </div>
        </div>
        <MfaCodeField
          id="create-organization-code"
          v-model="createCode"
          :disabled="createPending"
          label="Code MFA pour créer ce tenant"
        />
        <p
          v-if="createError"
          id="organization-create-message"
          class="form-message form-message--error"
          role="alert"
        >
          {{ createError }}
        </p>
        <p v-else id="organization-create-message" class="form-guidance">
          Portée : création d’un tenant isolé. L’identifiant ne pourra pas être modifié.
        </p>
        <button type="submit" :disabled="!canCreate" :aria-busy="createPending">
          {{ createPending ? "Création…" : "Créer le tenant" }}
        </button>
      </form>
    </section>
  </section>
</template>
