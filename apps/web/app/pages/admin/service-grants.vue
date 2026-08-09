<script setup lang="ts">
import { authErrorMessage } from "~/utils/auth";
import { mfaChallengeHeaders, validTotpCode } from "~/utils/mfa";
import {
  matchesGrantSearch,
  SERVICE_GRANT_STATUSES,
  serviceGrantStatusLabel,
  type ServiceGrantStatus,
} from "~/utils/service-grants";

definePageMeta({ layout: "admin" });
useHead({ title: "Services et accès — NTAuth" });

type LoadState = "locked" | "loading" | "ready" | "empty" | "error" | "forbidden";
type Service = { key: string; name: string; status: "active" };
type Organization = { id: string; name: string; slug: string; status: "active" | "suspended" };
type Member = {
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  status: "active" | "suspended";
  userId: string;
};
type OrganizationDetail = { members: Member[]; organization: Organization };
type Grant = {
  createdAt: string;
  id: string;
  organizationId: string;
  revokedAt: string | null;
  service: string;
  status: ServiceGrantStatus;
  updatedAt: string;
  userId: string;
};

const { request } = useAuthApi();
const services = ref<Service[]>([]);
const organizations = ref<Organization[]>([]);
const catalogueState = ref<LoadState>("locked");
const catalogueCode = ref("");
const catalogueError = ref("");

const selectedOrganization = ref<Organization | null>(null);
const organizationDetail = ref<OrganizationDetail | null>(null);
const grants = ref<Grant[]>([]);
const workspaceState = ref<LoadState>("locked");
const workspaceCode = ref("");
const workspaceError = ref("");

const query = ref("");
const statusFilter = ref<"" | ServiceGrantStatus>("");
const createService = ref("");
const createUserId = ref("");
const createCode = ref("");
const createPending = ref(false);
const createMessage = ref("");
const createError = ref(false);

const selectedGrant = ref<Grant | null>(null);
const preparedAction = ref<"activate" | "suspend" | "revoke" | null>(null);
const actionCode = ref("");
const actionPending = ref(false);
const confirmAction = ref(false);
const actionMessage = ref("");
const actionError = ref(false);
const actionTitle = ref<HTMLElement | null>(null);

const serviceByKey = computed(() => new Map(services.value.map((entry) => [entry.key, entry])));
const memberById = computed(
  () => new Map((organizationDetail.value?.members ?? []).map((member) => [member.userId, member])),
);
const activeMembers = computed(() =>
  (organizationDetail.value?.members ?? []).filter((member) => member.status === "active"),
);
const visibleGrants = computed(() =>
  grants.value.filter((grant) => {
    const member = memberById.value.get(grant.userId);
    const service = serviceByKey.value.get(grant.service);
    return (
      (!statusFilter.value || grant.status === statusFilter.value) &&
      matchesGrantSearch(query.value, [grant.service, service?.name, member?.name, member?.email])
    );
  }),
);

function safeError(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { code?: string };
    status?: number;
    statusCode?: number;
  };
  if (candidate.data?.code === "service_grant_conflict")
    return "Un accès courant existe déjà, ou le service n’est plus disponible.";
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Le code MFA est invalide, expiré ou cette portée ne vous est pas autorisée.";
  return authErrorMessage(error, fallback);
}

async function unlockCatalogue() {
  if (!validTotpCode(catalogueCode.value)) return;
  catalogueState.value = "loading";
  catalogueError.value = "";
  try {
    const result = await request<{ organizations: Organization[]; services: Service[] }>(
      "/api/v1/service-grants/administration",
      { headers: mfaChallengeHeaders(catalogueCode.value) },
    );
    services.value = result.services;
    organizations.value = result.organizations;
    catalogueState.value =
      result.services.length || result.organizations.length ? "ready" : "empty";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    catalogueState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    catalogueError.value = safeError(error, "Le catalogue ne peut pas être chargé.");
  } finally {
    catalogueCode.value = "";
  }
}

function selectOrganization(organization: Organization) {
  selectedOrganization.value = organization;
  organizationDetail.value = null;
  grants.value = [];
  workspaceState.value = "locked";
  workspaceError.value = "";
  createService.value = services.value[0]?.key ?? "";
  createUserId.value = "";
  selectedGrant.value = null;
  preparedAction.value = null;
}

async function loadWorkspace() {
  if (!selectedOrganization.value || !validTotpCode(workspaceCode.value)) return;
  workspaceState.value = "loading";
  workspaceError.value = "";
  try {
    const params = new URLSearchParams({ organizationId: selectedOrganization.value.id });
    const result = await request<{ detail: OrganizationDetail; grants: Grant[] }>(
      `/api/v1/service-grants/administration?${params}`,
      { headers: mfaChallengeHeaders(workspaceCode.value) },
    );
    organizationDetail.value = result.detail;
    grants.value = result.grants;
    createUserId.value =
      result.detail.members.find((member) => member.status === "active")?.userId ?? "";
    workspaceState.value = "ready";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    workspaceState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    workspaceError.value = safeError(error, "Les accès de cette organisation sont indisponibles.");
  } finally {
    workspaceCode.value = "";
  }
}

async function createGrant() {
  if (
    !selectedOrganization.value ||
    !createService.value ||
    !createUserId.value ||
    !validTotpCode(createCode.value)
  )
    return;
  createPending.value = true;
  createMessage.value = "";
  createError.value = false;
  try {
    const grant = await request<Grant>("/api/v1/service-grants", {
      body: {
        organizationId: selectedOrganization.value.id,
        service: createService.value,
        userId: createUserId.value,
      },
      headers: mfaChallengeHeaders(createCode.value),
      method: "POST",
    });
    grants.value = [grant, ...grants.value];
    createMessage.value = "Accès créé et audité dans la portée affichée.";
  } catch (error) {
    createError.value = true;
    createMessage.value = safeError(error, "L’accès n’a pas pu être créé.");
  } finally {
    createCode.value = "";
    createPending.value = false;
  }
}

async function prepareAction(grant: Grant, action: "activate" | "suspend" | "revoke") {
  selectedGrant.value = grant;
  preparedAction.value = action;
  confirmAction.value = false;
  actionCode.value = "";
  actionMessage.value = "";
  await nextTick();
  actionTitle.value?.focus();
  actionTitle.value?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function executeAction() {
  if (
    !selectedGrant.value ||
    !preparedAction.value ||
    !confirmAction.value ||
    !validTotpCode(actionCode.value)
  )
    return;
  actionPending.value = true;
  actionMessage.value = "";
  actionError.value = false;
  try {
    if (preparedAction.value === "revoke") {
      await request(`/api/v1/service-grants/${selectedGrant.value.id}`, {
        headers: mfaChallengeHeaders(actionCode.value),
        method: "DELETE",
      });
      selectedGrant.value.status = "revoked";
      selectedGrant.value.revokedAt = new Date().toISOString();
    } else {
      const updated = await request<Grant>(`/api/v1/service-grants/${selectedGrant.value.id}`, {
        body: { active: preparedAction.value === "activate" },
        headers: mfaChallengeHeaders(actionCode.value),
        method: "PATCH",
      });
      Object.assign(selectedGrant.value, updated);
    }
    actionMessage.value = `${serviceGrantStatusLabel(selectedGrant.value.status)} : effet immédiat et mutation auditée.`;
  } catch (error) {
    actionError.value = true;
    actionMessage.value = safeError(error, "L’accès n’a pas pu être modifié.");
  } finally {
    actionCode.value = "";
    confirmAction.value = false;
    actionPending.value = false;
  }
}
</script>

<template>
  <section class="grant-admin" aria-labelledby="grant-admin-title">
    <header class="grant-admin__header">
      <div>
        <h1 id="grant-admin-title">Services et accès</h1>
        <p>Accordez un service à un membre dans une seule organisation, sans élargir sa portée.</p>
      </div>
      <dl class="security-scope">
        <div>
          <dt>Portée</dt>
          <dd>Organisation · service · membre</dd>
        </div>
        <div>
          <dt>Effet</dt>
          <dd>Activation et suspension immédiates</dd>
        </div>
        <div>
          <dt>Trace</dt>
          <dd>Chaque mutation est auditée</dd>
        </div>
      </dl>
    </header>

    <section
      v-if="catalogueState === 'locked'"
      class="grant-gate"
      aria-labelledby="grant-gate-title"
    >
      <div>
        <h2 id="grant-gate-title">Ouvrir le catalogue administré</h2>
        <p>Un code MFA frais protège la liste des organisations et des services disponibles.</p>
      </div>
      <form method="post" @submit.prevent="unlockCatalogue">
        <MfaCodeField id="grant-catalogue-code" v-model="catalogueCode" label="Code MFA" />
        <button type="submit" :disabled="!validTotpCode(catalogueCode)">
          Charger le catalogue
        </button>
      </form>
    </section>
    <LoadingSkeleton
      v-else-if="catalogueState === 'loading'"
      label="Chargement du catalogue de services"
    />
    <div
      v-else-if="catalogueState === 'error' || catalogueState === 'forbidden'"
      class="state-panel"
    >
      <p role="alert">{{ catalogueError }}</p>
      <button type="button" class="text-button" @click="catalogueState = 'locked'">
        Réessayer
      </button>
    </div>
    <p v-else-if="catalogueState === 'empty'" class="state-panel">
      Aucun service ou organisation administrable n’est disponible.
    </p>

    <template v-else>
      <section class="grant-scope-picker" aria-labelledby="grant-scope-title">
        <div>
          <h2 id="grant-scope-title">Choisir l’organisation</h2>
          <p>{{ services.length }} service(s) actif(s) dans le catalogue.</p>
        </div>
        <div class="organization-choices">
          <button
            v-for="organization in organizations"
            :key="organization.id"
            type="button"
            :aria-current="selectedOrganization?.id === organization.id"
            @click="selectOrganization(organization)"
          >
            <strong>{{ organization.name }}</strong>
            <small>{{ organization.slug }} · {{ organization.status }}</small>
          </button>
        </div>
      </section>

      <section
        v-if="selectedOrganization"
        class="grant-workspace"
        aria-labelledby="grant-workspace-title"
      >
        <header>
          <div>
            <h2 id="grant-workspace-title">{{ selectedOrganization.name }}</h2>
            <p>Les résultats restent strictement limités à cette organisation.</p>
          </div>
          <button type="button" class="text-button" @click="selectedOrganization = null">
            Fermer
          </button>
        </header>

        <form
          v-if="workspaceState === 'locked'"
          class="grant-workspace__gate"
          method="post"
          @submit.prevent="loadWorkspace"
        >
          <MfaCodeField
            id="grant-workspace-code"
            v-model="workspaceCode"
            label="Nouveau code MFA pour cette portée"
          />
          <button type="submit" :disabled="!validTotpCode(workspaceCode)">Charger les accès</button>
        </form>
        <LoadingSkeleton
          v-else-if="workspaceState === 'loading'"
          label="Chargement des membres et des accès"
          :lines="4"
        />
        <div
          v-else-if="workspaceState === 'error' || workspaceState === 'forbidden'"
          class="state-panel"
        >
          <p role="alert">{{ workspaceError }}</p>
          <button type="button" class="text-button" @click="workspaceState = 'locked'">
            Réessayer
          </button>
        </div>

        <div v-else-if="workspaceState === 'ready'" class="grant-workspace__content">
          <section class="grant-creation" aria-labelledby="grant-create-title">
            <header>
              <h3 id="grant-create-title">Accorder un service</h3>
              <p>Portée : {{ selectedOrganization.name }} uniquement.</p>
            </header>
            <form method="post" @submit.prevent="createGrant">
              <div class="inline-fields">
                <label class="field">
                  <span>Service actif</span>
                  <select v-model="createService" required>
                    <option v-for="service in services" :key="service.key" :value="service.key">
                      {{ service.name }} ({{ service.key }})
                    </option>
                  </select>
                </label>
                <label class="field">
                  <span>Membre actif</span>
                  <select v-model="createUserId" required>
                    <option
                      v-for="member in activeMembers"
                      :key="member.userId"
                      :value="member.userId"
                    >
                      {{ member.name }} — {{ member.email }}
                    </option>
                  </select>
                </label>
              </div>
              <MfaCodeField
                id="grant-create-code"
                v-model="createCode"
                label="Code MFA pour accorder"
              />
              <p
                v-if="createMessage"
                :role="createError ? 'alert' : 'status'"
                :class="['form-message', { 'form-message--error': createError }]"
              >
                {{ createMessage }}
              </p>
              <button
                type="submit"
                :disabled="
                  createPending || !createService || !createUserId || !validTotpCode(createCode)
                "
              >
                {{ createPending ? "Création…" : "Accorder l’accès" }}
              </button>
            </form>
          </section>

          <section class="grant-register" aria-labelledby="grant-register-title">
            <header>
              <div>
                <h3 id="grant-register-title">Accès</h3>
                <p>{{ visibleGrants.length }} résultat(s)</p>
              </div>
              <div class="grant-filters">
                <label class="field">
                  <span>Rechercher</span>
                  <input v-model="query" type="search" placeholder="Service, nom ou e-mail" />
                </label>
                <label class="field">
                  <span>Statut</span>
                  <select v-model="statusFilter">
                    <option value="">Tous</option>
                    <option v-for="status in SERVICE_GRANT_STATUSES" :key="status" :value="status">
                      {{ serviceGrantStatusLabel(status) }}
                    </option>
                  </select>
                </label>
              </div>
            </header>
            <p v-if="!visibleGrants.length" class="state-panel">
              Aucun accès ne correspond à ces filtres.
            </p>
            <ul v-else class="grant-list">
              <li v-for="grant in visibleGrants" :key="grant.id">
                <div>
                  <strong>{{ serviceByKey.get(grant.service)?.name ?? grant.service }}</strong>
                  <small
                    >{{ grant.service }} ·
                    {{ memberById.get(grant.userId)?.email ?? grant.userId }}</small
                  >
                </div>
                <span :class="['grant-status', `grant-status--${grant.status}`]">
                  {{ serviceGrantStatusLabel(grant.status) }}
                </span>
                <div v-if="grant.status !== 'revoked'" class="grant-actions">
                  <button
                    type="button"
                    class="text-button"
                    @click="
                      prepareAction(grant, grant.status === 'active' ? 'suspend' : 'activate')
                    "
                  >
                    {{
                      grant.status === "active" ? "Préparer la suspension" : "Préparer l’activation"
                    }}
                  </button>
                  <button
                    type="button"
                    class="text-button text-button--danger"
                    @click="prepareAction(grant, 'revoke')"
                  >
                    Préparer la révocation
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <section
            v-if="selectedGrant && preparedAction"
            class="grant-action"
            aria-labelledby="grant-action-title"
          >
            <h3 id="grant-action-title" ref="actionTitle" tabindex="-1">
              Confirmer la
              {{
                preparedAction === "activate"
                  ? "réactivation"
                  : preparedAction === "suspend"
                    ? "suspension"
                    : "révocation"
              }}
            </h3>
            <p>
              Portée exacte : {{ selectedOrganization.name }} · {{ selectedGrant.service }} ·
              {{ memberById.get(selectedGrant.userId)?.email ?? selectedGrant.userId }}.
            </p>
            <form method="post" @submit.prevent="executeAction">
              <label class="confirmation">
                <input v-model="confirmAction" type="checkbox" />
                <span>Je confirme l’effet immédiat de cette action auditée.</span>
              </label>
              <MfaCodeField
                id="grant-action-code"
                v-model="actionCode"
                label="Code MFA pour confirmer"
              />
              <p
                v-if="actionMessage"
                :role="actionError ? 'alert' : 'status'"
                :class="['form-message', { 'form-message--error': actionError }]"
                aria-live="polite"
              >
                {{ actionMessage }}
              </p>
              <div class="filter-actions">
                <button
                  type="submit"
                  :aria-busy="actionPending"
                  :disabled="actionPending || !confirmAction || !validTotpCode(actionCode)"
                >
                  {{ actionPending ? "Application…" : "Appliquer maintenant" }}
                </button>
                <button type="button" class="text-button" @click="preparedAction = null">
                  Annuler
                </button>
              </div>
            </form>
          </section>
        </div>
      </section>
    </template>
  </section>
</template>
