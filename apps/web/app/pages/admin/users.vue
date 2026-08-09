<script setup lang="ts">
import { authErrorMessage } from "~/utils/auth";
import {
  sessionState,
  sessionStateLabel,
  USER_STATUSES,
  userStatusLabel,
  type ReversibleUserStatus,
  type UserStatus,
} from "~/utils/users";

definePageMeta({ layout: "admin" });
useHead({ title: "Utilisateurs — NTAuth" });

type LoadState = "locked" | "loading" | "ready" | "empty" | "error" | "forbidden";
type UserSummary = {
  createdAt: string;
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
  organizationCount: number;
  sessionCount: number;
  status: UserStatus;
  statusChangedAt: string | null;
  updatedAt: string;
};
type UserSession = {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
};
type Membership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "owner" | "admin" | "member";
  status: "active" | "suspended";
};
type UserDetail = {
  identity: Omit<UserSummary, "organizationCount" | "sessionCount">;
  memberships: Membership[];
  sessions: UserSession[];
};
type RegistryPage = { items: UserSummary[]; nextOffset: number | null; total: number };

const PAGE_SIZE = 20;
const { request } = useAuthApi();
const { challengeHeaders, challengeReady } = useMfaChallenge();
const users = ref<UserSummary[]>([]);
const registryState = ref<LoadState>("locked");
const registryCode = ref("");
const registryError = ref("");
const query = ref("");
const statusFilter = ref<"" | UserStatus>("");
const offset = ref(0);
const nextOffset = ref<number | null>(null);
const total = ref(0);

const selectedSummary = ref<UserSummary | null>(null);
const detail = ref<UserDetail | null>(null);
const detailState = ref<LoadState>("locked");
const detailCode = ref("");
const detailError = ref("");
const detailTitle = ref<HTMLElement | null>(null);

const nextStatus = ref<ReversibleUserStatus>("active");
const statusCode = ref("");
const statusPending = ref(false);
const confirmStatus = ref(false);
const statusMessage = ref("");
const statusError = ref(false);

const revocationReason = ref<"administrative" | "compromised">("administrative");
const revokeCode = ref("");
const revokePending = ref(false);
const confirmRevocation = ref(false);
const revokeMessage = ref("");
const revokeError = ref(false);

const pageStart = computed(() => (total.value ? offset.value + 1 : 0));
const pageEnd = computed(() => Math.min(offset.value + users.value.length, total.value));

function safeError(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { code?: string };
    status?: number;
    statusCode?: number;
  };
  if (candidate.data?.code === "invalid_user_transition")
    return "Cette transition n’est plus possible. Rechargez l’identité avant de réessayer.";
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Le code MFA est invalide, expiré ou cette action ne vous est pas autorisée.";
  return authErrorMessage(error, fallback);
}

async function loadRegistry(targetOffset = 0) {
  if (!challengeReady(registryCode.value)) return;
  registryState.value = "loading";
  registryError.value = "";
  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(targetOffset) });
    if (query.value.trim()) params.set("query", query.value.trim());
    if (statusFilter.value) params.set("status", statusFilter.value);
    const result = await request<RegistryPage>(`/api/v1/users?${params}`, {
      headers: challengeHeaders(registryCode.value),
    });
    users.value = result.items;
    offset.value = targetOffset;
    nextOffset.value = result.nextOffset;
    total.value = result.total;
    registryState.value = result.items.length ? "ready" : "empty";
    if (selectedSummary.value && !result.items.some(({ id }) => id === selectedSummary.value?.id)) {
      selectedSummary.value = null;
      detail.value = null;
      detailState.value = "locked";
    }
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    registryState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    registryError.value = safeError(error, "Le registre des utilisateurs ne peut pas être chargé.");
  } finally {
    registryCode.value = "";
  }
}

function resetFilters() {
  query.value = "";
  statusFilter.value = "";
  offset.value = 0;
  registryState.value = "locked";
}

function selectUser(identity: UserSummary) {
  selectedSummary.value = identity;
  detail.value = null;
  detailState.value = "locked";
  detailCode.value = "";
  detailError.value = "";
  nextStatus.value = identity.status === "deleted" ? "deactivated" : identity.status;
  statusMessage.value = "";
  revokeMessage.value = "";
}

async function loadDetail() {
  if (!selectedSummary.value || !challengeReady(detailCode.value)) return;
  detailState.value = "loading";
  detailError.value = "";
  try {
    detail.value = await request<UserDetail>(`/api/v1/users/${selectedSummary.value.id}`, {
      headers: challengeHeaders(detailCode.value),
    });
    nextStatus.value =
      detail.value.identity.status === "deleted" ? "deactivated" : detail.value.identity.status;
    detailState.value = "ready";
    await nextTick();
    detailTitle.value?.focus();
    detailTitle.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    detailState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    detailError.value = safeError(error, "Le détail de cette identité ne peut pas être chargé.");
  } finally {
    detailCode.value = "";
  }
}

async function changeStatus() {
  if (
    !detail.value ||
    !selectedSummary.value ||
    !confirmStatus.value ||
    !challengeReady(statusCode.value)
  )
    return;
  statusPending.value = true;
  statusMessage.value = "";
  statusError.value = false;
  try {
    const updated = await request<{ id: string; status: ReversibleUserStatus }>(
      `/api/v1/users/${selectedSummary.value.id}/status`,
      {
        body: { status: nextStatus.value },
        headers: challengeHeaders(statusCode.value),
        method: "PATCH",
      },
    );
    selectedSummary.value.status = updated.status;
    selectedSummary.value.sessionCount = 0;
    detail.value.identity.status = updated.status;
    detail.value.sessions = [];
    statusMessage.value = `${userStatusLabel(updated.status)} : sessions existantes révoquées, changement audité.`;
  } catch (error) {
    statusError.value = true;
    statusMessage.value = safeError(error, "Le statut de cette identité n’a pas pu être modifié.");
  } finally {
    statusCode.value = "";
    confirmStatus.value = false;
    statusPending.value = false;
  }
}

async function revokeSessions() {
  if (
    !detail.value ||
    !selectedSummary.value ||
    !confirmRevocation.value ||
    !challengeReady(revokeCode.value)
  )
    return;
  revokePending.value = true;
  revokeMessage.value = "";
  revokeError.value = false;
  try {
    const result = await request<{ revokedCount: number }>(
      `/api/v1/users/${selectedSummary.value.id}/sessions/revoke`,
      {
        body: { reason: revocationReason.value },
        headers: challengeHeaders(revokeCode.value),
        method: "POST",
      },
    );
    detail.value.sessions = [];
    selectedSummary.value.sessionCount = 0;
    revokeMessage.value = `${result.revokedCount} session(s) révoquée(s). L’action et son motif sont audités.`;
  } catch (error) {
    revokeError.value = true;
    revokeMessage.value = safeError(error, "Les sessions n’ont pas pu être révoquées.");
  } finally {
    revokeCode.value = "";
    confirmRevocation.value = false;
    revokePending.value = false;
  }
}
</script>

<template>
  <section class="user-admin" aria-labelledby="users-title">
    <header class="user-admin__header">
      <div>
        <h1 id="users-title">Utilisateurs et sessions</h1>
        <p>Intervenez sur une identité précise sans exposer ses secrets de session.</p>
      </div>
      <dl class="assurance-list">
        <div>
          <dt>Portée</dt>
          <dd>Registre réservé aux administrateurs plateforme</dd>
        </div>
        <div>
          <dt>Effet</dt>
          <dd>Suspension et désactivation ferment les sessions</dd>
        </div>
        <div>
          <dt>Journal</dt>
          <dd>Consultations, filtres et mutations sont audités</dd>
        </div>
      </dl>
    </header>

    <section class="user-filters" aria-labelledby="user-filters-title">
      <div>
        <h2 id="user-filters-title">Registre protégé</h2>
        <p>Recherche sur le nom ou l’e-mail, avec pagination serveur.</p>
      </div>
      <form method="post" @submit.prevent="loadRegistry(0)">
        <div class="inline-fields">
          <div class="field">
            <label for="user-query">Rechercher</label
            ><input
              id="user-query"
              v-model="query"
              type="search"
              maxlength="160"
              placeholder="Nom ou adresse e-mail"
            />
          </div>
          <div class="field">
            <label for="user-status-filter">Statut</label
            ><select id="user-status-filter" v-model="statusFilter">
              <option value="">Tous les statuts</option>
              <option v-for="status in USER_STATUSES" :key="status" :value="status">
                {{ userStatusLabel(status) }}
              </option>
            </select>
          </div>
        </div>
        <MfaCodeField
          id="user-registry-code"
          v-model="registryCode"
          label="Code MFA pour cette page du registre"
        />
        <div class="filter-actions">
          <button type="submit" :disabled="!challengeReady(registryCode)">Rechercher</button>
          <button type="button" class="text-button" @click="resetFilters">
            Effacer les filtres
          </button>
        </div>
      </form>
    </section>

    <p v-if="registryState === 'locked'" class="state-panel">
      Saisissez un code MFA pour ouvrir une session d’administration de 10 minutes.
    </p>
    <LoadingSkeleton
      v-else-if="registryState === 'loading'"
      label="Chargement des identités autorisées"
      :lines="5"
    />
    <div
      v-else-if="registryState === 'error' || registryState === 'forbidden'"
      class="state-panel state-panel--error"
      role="alert"
    >
      <h2>{{ registryState === "forbidden" ? "Registre interdit" : "Chargement interrompu" }}</h2>
      <p>{{ registryError }}</p>
      <button type="button" @click="registryState = 'locked'">Réessayer</button>
    </div>
    <div v-else-if="registryState === 'empty'" class="state-panel">
      <h2>Aucune identité trouvée</h2>
      <p>Modifiez les filtres. Un code MFA n’est demandé que si la session doit être réactivée.</p>
    </div>

    <section v-else-if="registryState === 'ready'" class="user-workspace">
      <aside class="user-register" aria-labelledby="user-register-title">
        <header>
          <div>
            <h2 id="user-register-title">Identités</h2>
            <p>{{ pageStart }}–{{ pageEnd }} sur {{ total }}</p>
          </div>
        </header>
        <ul class="user-list">
          <li v-for="identity in users" :key="identity.id">
            <button
              type="button"
              :aria-current="selectedSummary?.id === identity.id ? 'true' : undefined"
              @click="selectUser(identity)"
            >
              <span
                ><strong>{{ identity.name }}</strong
                ><small>{{ identity.email }}</small></span
              >
              <span
                ><strong>{{ userStatusLabel(identity.status) }}</strong
                ><small
                  >{{ identity.sessionCount }} session(s) ·
                  {{ identity.organizationCount }} org.</small
                ></span
              >
            </button>
          </li>
        </ul>
        <footer class="registry-pagination">
          <div>
            <button
              type="button"
              class="text-button"
              :disabled="offset === 0 || !challengeReady(registryCode)"
              @click="loadRegistry(Math.max(0, offset - PAGE_SIZE))"
            >
              Page précédente
            </button>
            <button
              type="button"
              class="text-button"
              :disabled="nextOffset === null || !challengeReady(registryCode)"
              @click="loadRegistry(nextOffset ?? offset)"
            >
              Page suivante
            </button>
          </div>
          <MfaCodeField
            id="user-pagination-code"
            v-model="registryCode"
            label="Code MFA pour réactiver la session"
          />
        </footer>
      </aside>

      <section v-if="!selectedSummary" class="user-detail user-detail--empty">
        <p>Sélectionnez une identité pour consulter ses memberships et ses sessions.</p>
      </section>
      <section v-else class="user-detail" aria-labelledby="user-detail-title">
        <header>
          <div>
            <h2 id="user-detail-title" ref="detailTitle" tabindex="-1">
              {{ selectedSummary.name }}
            </h2>
            <p>{{ selectedSummary.email }}</p>
          </div>
          <button type="button" class="text-button" @click="selectedSummary = null">Fermer</button>
        </header>
        <form
          v-if="detailState === 'locked'"
          class="detail-gate"
          method="post"
          @submit.prevent="loadDetail"
        >
          <p>Une session d’administration active protège l’accès aux sessions de cette identité.</p>
          <MfaCodeField
            id="user-detail-code"
            v-model="detailCode"
            label="Code MFA pour ce détail"
          />
          <button type="submit" :disabled="!challengeReady(detailCode)">Ouvrir l’identité</button>
        </form>
        <LoadingSkeleton
          v-else-if="detailState === 'loading'"
          label="Chargement des memberships et des sessions"
          :lines="4"
        />
        <div
          v-else-if="detailState === 'error' || detailState === 'forbidden'"
          class="state-panel state-panel--error"
          role="alert"
        >
          <h3>Identité inaccessible</h3>
          <p>{{ detailError }}</p>
          <button type="button" @click="detailState = 'locked'">Réessayer</button>
        </div>

        <template v-else-if="detail">
          <dl class="identity-facts">
            <div>
              <dt>Statut</dt>
              <dd>{{ userStatusLabel(detail.identity.status) }}</dd>
            </div>
            <div>
              <dt>E-mail vérifié</dt>
              <dd>{{ detail.identity.emailVerified ? "Oui" : "Non" }}</dd>
            </div>
            <div>
              <dt>Création</dt>
              <dd>{{ new Date(detail.identity.createdAt).toLocaleDateString("fr-FR") }}</dd>
            </div>
          </dl>

          <section class="membership-overview" aria-labelledby="user-memberships-title">
            <header>
              <h3 id="user-memberships-title">Memberships</h3>
              <span>{{ detail.memberships.length }}</span>
            </header>
            <p v-if="!detail.memberships.length" class="empty-line">Aucune organisation liée.</p>
            <ul v-else>
              <li v-for="membership in detail.memberships" :key="membership.organizationId">
                <span
                  ><strong>{{ membership.organizationName }}</strong
                  ><small>{{ membership.organizationSlug }}</small></span
                >
                <span>{{ membership.role }} · {{ membership.status }}</span>
              </li>
            </ul>
          </section>

          <section class="session-overview" aria-labelledby="user-sessions-title">
            <header>
              <h3 id="user-sessions-title">Sessions</h3>
              <span>{{ detail.sessions.length }}</span>
            </header>
            <p v-if="!detail.sessions.length" class="empty-line">Aucune session persistante.</p>
            <ul v-else class="session-list">
              <li v-for="userSession in detail.sessions" :key="userSession.id">
                <span
                  ><strong>{{ userSession.userAgent || "Navigateur non renseigné" }}</strong
                  ><small>{{ userSession.ipAddress || "Adresse IP non conservée" }}</small></span
                >
                <span
                  :class="[
                    'session-state',
                    { 'session-state--expired': sessionState(userSession.expiresAt) === 'expired' },
                  ]"
                  >{{ sessionStateLabel(userSession.expiresAt)
                  }}<small
                    >jusqu’au {{ new Date(userSession.expiresAt).toLocaleString("fr-FR") }}</small
                  ></span
                >
              </li>
            </ul>
          </section>

          <form
            class="session-revocation"
            aria-describedby="session-revoke-message"
            method="post"
            @submit.prevent="revokeSessions"
          >
            <h3>Révoquer toutes les sessions</h3>
            <div class="field">
              <label for="revocation-reason">Motif audité</label
              ><select id="revocation-reason" v-model="revocationReason">
                <option value="administrative">Action administrative</option>
                <option value="compromised">Compte potentiellement compromis</option>
              </select>
            </div>
            <label class="confirmation"
              ><input v-model="confirmRevocation" type="checkbox" /> Je confirme la fermeture
              immédiate de toutes les sessions de {{ detail.identity.email }}.</label
            >
            <MfaCodeField
              id="session-revoke-code"
              v-model="revokeCode"
              :disabled="revokePending"
              label="Code MFA pour révoquer"
            />
            <p
              id="session-revoke-message"
              :class="['form-message', { 'form-message--error': revokeError }]"
              aria-live="polite"
            >
              {{
                revokeMessage ||
                "Portée : toutes les sessions persistantes de cette seule identité."
              }}
            </p>
            <button
              type="submit"
              :aria-busy="revokePending"
              :disabled="!confirmRevocation || !challengeReady(revokeCode) || revokePending"
            >
              {{ revokePending ? "Révocation…" : "Révoquer les sessions" }}
            </button>
          </form>

          <form
            class="status-editor"
            aria-describedby="user-status-message"
            method="post"
            @submit.prevent="changeStatus"
          >
            <h3>Modifier le cycle de vie</h3>
            <div class="field">
              <label for="next-user-status">Nouveau statut</label
              ><select id="next-user-status" v-model="nextStatus">
                <option value="active">Actif</option>
                <option value="suspended">Suspendu</option>
                <option value="deactivated">Désactivé</option>
              </select>
            </div>
            <label class="confirmation"
              ><input v-model="confirmStatus" type="checkbox" /> Je confirme ce changement et la
              révocation automatique des sessions.</label
            >
            <MfaCodeField
              id="user-status-code"
              v-model="statusCode"
              :disabled="statusPending"
              label="Code MFA pour changer le statut"
            />
            <p
              id="user-status-message"
              :class="['form-message', { 'form-message--error': statusError }]"
              aria-live="polite"
            >
              {{
                statusMessage ||
                "Portée : statut de cette identité et toutes ses sessions actuelles. Action auditée."
              }}
            </p>
            <button
              type="submit"
              :disabled="
                detail.identity.status === 'deleted' ||
                nextStatus === detail.identity.status ||
                !confirmStatus ||
                !challengeReady(statusCode) ||
                statusPending
              "
            >
              {{ statusPending ? "Modification…" : "Appliquer le statut" }}
            </button>
          </form>
        </template>
      </section>
    </section>
  </section>
</template>
