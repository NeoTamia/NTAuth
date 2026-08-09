<script setup lang="ts">
import {
  auditActionLabel,
  auditOutcomeLabel,
  exclusiveDayAfter,
  type AuditOutcome,
} from "~/utils/audit-events";
import { authErrorMessage } from "~/utils/auth";
import { mfaChallengeHeaders, validTotpCode } from "~/utils/mfa";

definePageMeta({ layout: "admin" });
useHead({ title: "Journal d’audit — NTAuth" });

type LoadState = "locked" | "loading" | "ready" | "empty" | "error" | "forbidden";
type Organization = { id: string; name: string; slug: string };
type Service = { key: string; name: string };
type AuditEvent = {
  action: string;
  actor: { id: string | null; type: "system" | "user" };
  correlationId: string;
  createdAt: string;
  id: string;
  metadata: Record<string, boolean | number | string | null>;
  outcome: AuditOutcome;
  scope: { organizationId: string | null; service: string | null };
  target: { id: string | null; type: string };
};
type AuditPage = {
  events: AuditEvent[];
  nextCursor: string | null;
  retentionDays: number;
};

const PAGE_SIZE = 25;
const { request } = useAuthApi();
const organizations = ref<Organization[]>([]);
const services = ref<Service[]>([]);
const scopesState = ref<LoadState>("locked");
const scopesCode = ref("");
const scopesError = ref("");

const scopeMode = ref<"organization" | "service">("organization");
const organizationId = ref("");
const service = ref("");
const serviceFilter = ref("");
const actorUserId = ref("");
const action = ref("");
const outcome = ref<"" | AuditOutcome>("");
const fromDate = ref("");
const toDate = ref("");

const journalState = ref<LoadState>("locked");
const journalCode = ref("");
const journalError = ref("");
const events = ref<AuditEvent[]>([]);
const retentionDays = ref(365);
const nextCursor = ref<string | null>(null);
const pageCursors = ref<Array<string | undefined>>([undefined]);
const pageIndex = ref(0);
const selectedEvent = ref<AuditEvent | null>(null);
const detailTitle = ref<HTMLElement | null>(null);

const exportCode = ref("");
const confirmExport = ref(false);
const exportPending = ref(false);
const exportMessage = ref("");
const exportError = ref(false);

const selectedScopeLabel = computed(() => {
  if (scopeMode.value === "organization")
    return (
      organizations.value.find(({ id }) => id === organizationId.value)?.name ?? "Organisation"
    );
  return services.value.find(({ key }) => key === service.value)?.name ?? "Service";
});

function safeError(error: unknown, fallback: string) {
  const candidate = error as { status?: number; statusCode?: number };
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Le code MFA est invalide, expiré ou cette portée ne vous est pas autorisée.";
  return authErrorMessage(error, fallback);
}

function buildQuery(cursor?: string) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (scopeMode.value === "organization") {
    params.set("organization_id", organizationId.value);
    if (serviceFilter.value) params.set("service", serviceFilter.value);
  } else {
    params.set("service", service.value);
  }
  if (actorUserId.value.trim()) params.set("actor_user_id", actorUserId.value.trim());
  if (action.value.trim()) params.set("action", action.value.trim());
  if (outcome.value) params.set("outcome", outcome.value);
  if (fromDate.value) params.set("from", `${fromDate.value}T00:00:00.000Z`);
  const exclusiveTo = exclusiveDayAfter(toDate.value);
  if (exclusiveTo) params.set("to", exclusiveTo);
  if (cursor) params.set("cursor", cursor);
  return params;
}

async function unlockScopes() {
  if (!validTotpCode(scopesCode.value)) return;
  scopesState.value = "loading";
  scopesError.value = "";
  try {
    const result = await request<{ organizations: Organization[]; services: Service[] }>(
      "/api/v1/audit-events/scopes",
      { headers: mfaChallengeHeaders(scopesCode.value) },
    );
    organizations.value = result.organizations;
    services.value = result.services;
    organizationId.value = result.organizations[0]?.id ?? "";
    service.value = result.services[0]?.key ?? "";
    scopesState.value = result.organizations.length || result.services.length ? "ready" : "empty";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    scopesState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    scopesError.value = safeError(error, "Les portées d’audit ne peuvent pas être chargées.");
  } finally {
    scopesCode.value = "";
  }
}

function resetJournal() {
  journalState.value = "locked";
  journalError.value = "";
  events.value = [];
  nextCursor.value = null;
  pageCursors.value = [undefined];
  pageIndex.value = 0;
  selectedEvent.value = null;
  exportMessage.value = "";
}

async function loadEvents(targetIndex = 0, cursor?: string) {
  if (!validTotpCode(journalCode.value)) return;
  journalState.value = "loading";
  journalError.value = "";
  selectedEvent.value = null;
  try {
    const result = await request<AuditPage>(`/api/v1/audit-events?${buildQuery(cursor)}`, {
      headers: mfaChallengeHeaders(journalCode.value),
    });
    events.value = result.events;
    retentionDays.value = result.retentionDays;
    nextCursor.value = result.nextCursor;
    pageIndex.value = targetIndex;
    pageCursors.value[targetIndex] = cursor;
    journalState.value = result.events.length ? "ready" : "empty";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    journalState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    journalError.value = safeError(error, "Le journal ne peut pas être chargé.");
  } finally {
    journalCode.value = "";
  }
}

function nextPage() {
  if (!nextCursor.value) return;
  void loadEvents(pageIndex.value + 1, nextCursor.value);
}

function previousPage() {
  if (pageIndex.value === 0) return;
  const target = pageIndex.value - 1;
  void loadEvents(target, pageCursors.value[target]);
}

async function inspectEvent(event: AuditEvent) {
  selectedEvent.value = event;
  await nextTick();
  detailTitle.value?.focus();
  detailTitle.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function exportEvents() {
  if (!confirmExport.value || !validTotpCode(exportCode.value)) return;
  exportPending.value = true;
  exportMessage.value = "";
  exportError.value = false;
  try {
    const params = buildQuery();
    params.delete("limit");
    const blob = await request<Blob>(`/api/v1/audit-events/export?${params}`, {
      headers: mfaChallengeHeaders(exportCode.value),
      responseType: "blob",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ntauth-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    exportMessage.value =
      "Export CSV généré à partir des seules données masquées visibles dans cette portée.";
  } catch (error) {
    exportError.value = true;
    exportMessage.value = safeError(error, "L’export protégé a échoué.");
  } finally {
    exportCode.value = "";
    confirmExport.value = false;
    exportPending.value = false;
  }
}
</script>

<template>
  <section class="audit-admin" aria-labelledby="audit-title">
    <header class="audit-admin__header">
      <div>
        <h1 id="audit-title">Journal d’audit</h1>
        <p>Reconstituez une action sensible sans révéler les secrets retirés à l’écriture.</p>
      </div>
      <dl class="security-scope">
        <div>
          <dt>Rétention</dt>
          <dd>{{ retentionDays }} jours</dd>
        </div>
        <div>
          <dt>Ordre</dt>
          <dd>Curseur stable, du plus récent au plus ancien</dd>
        </div>
        <div>
          <dt>Export</dt>
          <dd>CSV masqué et génération auditée</dd>
        </div>
      </dl>
    </header>

    <section v-if="scopesState === 'locked'" class="audit-gate" aria-labelledby="audit-gate-title">
      <div>
        <h2 id="audit-gate-title">Déverrouiller les portées autorisées</h2>
        <p>Un code MFA frais protège la découverte des organisations et services consultables.</p>
      </div>
      <form method="post" @submit.prevent="unlockScopes">
        <MfaCodeField id="audit-scopes-code" v-model="scopesCode" label="Code MFA" />
        <button type="submit" :disabled="!validTotpCode(scopesCode)">Charger les portées</button>
      </form>
    </section>
    <LoadingSkeleton v-else-if="scopesState === 'loading'" label="Chargement des portées d’audit" />
    <div v-else-if="scopesState === 'error' || scopesState === 'forbidden'" class="state-panel">
      <p role="alert">{{ scopesError }}</p>
      <button type="button" class="text-button" @click="scopesState = 'locked'">Réessayer</button>
    </div>
    <p v-else-if="scopesState === 'empty'" class="state-panel">
      Aucune portée d’audit ne vous est actuellement autorisée.
    </p>

    <template v-else>
      <section class="audit-filters" aria-labelledby="audit-filters-title">
        <header>
          <div>
            <h2 id="audit-filters-title">Définir la recherche</h2>
            <p>Une portée est toujours obligatoire.</p>
          </div>
          <button type="button" class="text-button" @click="resetJournal">
            Réinitialiser le résultat
          </button>
        </header>
        <form method="post" @submit.prevent="loadEvents(0)">
          <fieldset class="choice-field choice-field--inline">
            <legend>Type de portée</legend>
            <label
              ><input
                v-model="scopeMode"
                type="radio"
                value="organization"
                @change="resetJournal"
              />
              Organisation</label
            >
            <label
              ><input v-model="scopeMode" type="radio" value="service" @change="resetJournal" />
              Service global</label
            >
          </fieldset>
          <div class="audit-filter-grid">
            <label v-if="scopeMode === 'organization'" class="field">
              <span>Organisation</span>
              <select v-model="organizationId" required @change="resetJournal">
                <option v-for="entry in organizations" :key="entry.id" :value="entry.id">
                  {{ entry.name }} — {{ entry.slug }}
                </option>
              </select>
            </label>
            <label v-else class="field">
              <span>Service</span>
              <select v-model="service" required @change="resetJournal">
                <option v-for="entry in services" :key="entry.key" :value="entry.key">
                  {{ entry.name }} — {{ entry.key }}
                </option>
              </select>
            </label>
            <label v-if="scopeMode === 'organization'" class="field">
              <span>Service dans cette organisation</span>
              <select v-model="serviceFilter" @change="resetJournal">
                <option value="">Tous les services</option>
                <option v-for="entry in services" :key="entry.key" :value="entry.key">
                  {{ entry.name }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>Identifiant de l’acteur</span>
              <input
                v-model="actorUserId"
                maxlength="128"
                placeholder="Optionnel"
                @input="resetJournal"
              />
            </label>
            <label class="field">
              <span>Action exacte</span>
              <input
                v-model="action"
                maxlength="128"
                placeholder="iam.policy.create"
                @input="resetJournal"
              />
            </label>
            <label class="field">
              <span>Résultat</span>
              <select v-model="outcome" @change="resetJournal">
                <option value="">Tous</option>
                <option value="success">Autorisé</option>
                <option value="denied">Refusé</option>
              </select>
            </label>
            <label class="field"
              ><span>Du</span><input v-model="fromDate" type="date" @change="resetJournal"
            /></label>
            <label class="field"
              ><span>Au</span><input v-model="toDate" type="date" @change="resetJournal"
            /></label>
          </div>
          <MfaCodeField
            id="audit-query-code"
            v-model="journalCode"
            label="Code MFA pour cette page"
          />
          <button
            type="submit"
            :disabled="
              !validTotpCode(journalCode) ||
              (scopeMode === 'organization' ? !organizationId : !service)
            "
          >
            Rechercher
          </button>
        </form>
      </section>

      <p v-if="journalState === 'locked'" class="state-panel">
        Définissez les filtres puis fournissez un code MFA frais.
      </p>
      <LoadingSkeleton
        v-else-if="journalState === 'loading'"
        label="Recherche dans le journal d’audit"
        :lines="5"
      />
      <div v-else-if="journalState === 'error' || journalState === 'forbidden'" class="state-panel">
        <p role="alert">{{ journalError }}</p>
        <button type="button" class="text-button" @click="journalState = 'locked'">
          Réessayer
        </button>
      </div>
      <p v-else-if="journalState === 'empty'" class="state-panel">
        Aucun événement ne correspond à cette portée et à ces filtres.
      </p>

      <section v-else class="audit-workspace" aria-label="Résultats d’audit">
        <div class="audit-register">
          <header>
            <div>
              <h2>{{ selectedScopeLabel }}</h2>
              <p>Page {{ pageIndex + 1 }} · {{ events.length }} événement(s)</p>
            </div>
          </header>
          <ol class="audit-event-list">
            <li v-for="event in events" :key="event.id">
              <button
                type="button"
                :aria-current="selectedEvent?.id === event.id"
                @click="inspectEvent(event)"
              >
                <time :datetime="event.createdAt">{{
                  new Date(event.createdAt).toLocaleString("fr-FR")
                }}</time>
                <strong>{{ auditActionLabel(event.action) }}</strong>
                <span :class="['audit-outcome', `audit-outcome--${event.outcome}`]">
                  {{ auditOutcomeLabel(event.outcome) }}
                </span>
                <small>{{ event.actor.id ?? "Système" }} · {{ event.target.type }}</small>
              </button>
            </li>
          </ol>
          <footer class="audit-pagination">
            <div>
              <button
                type="button"
                class="text-button"
                :disabled="pageIndex === 0 || !validTotpCode(journalCode)"
                @click="previousPage"
              >
                Page précédente
              </button>
              <button
                type="button"
                class="text-button"
                :disabled="!nextCursor || !validTotpCode(journalCode)"
                @click="nextPage"
              >
                Page suivante
              </button>
            </div>
            <MfaCodeField
              id="audit-page-code"
              v-model="journalCode"
              label="Nouveau code MFA pour paginer"
            />
          </footer>
        </div>

        <article v-if="selectedEvent" class="audit-detail" aria-labelledby="audit-detail-title">
          <header>
            <div>
              <h2 id="audit-detail-title" ref="detailTitle" tabindex="-1">
                {{ auditActionLabel(selectedEvent.action) }}
              </h2>
              <p>{{ new Date(selectedEvent.createdAt).toLocaleString("fr-FR") }}</p>
            </div>
            <button type="button" class="text-button" @click="selectedEvent = null">Fermer</button>
          </header>
          <dl class="audit-facts">
            <div>
              <dt>Résultat</dt>
              <dd>{{ auditOutcomeLabel(selectedEvent.outcome) }}</dd>
            </div>
            <div>
              <dt>Acteur</dt>
              <dd>{{ selectedEvent.actor.id ?? "Système" }}</dd>
            </div>
            <div>
              <dt>Cible</dt>
              <dd>{{ selectedEvent.target.type }} · {{ selectedEvent.target.id ?? "—" }}</dd>
            </div>
            <div>
              <dt>Organisation</dt>
              <dd>{{ selectedEvent.scope.organizationId ?? "Globale" }}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{{ selectedEvent.scope.service ?? "—" }}</dd>
            </div>
            <div>
              <dt>Corrélation</dt>
              <dd>{{ selectedEvent.correlationId }}</dd>
            </div>
          </dl>
          <section class="audit-metadata" aria-labelledby="audit-metadata-title">
            <h3 id="audit-metadata-title">Métadonnées autorisées</h3>
            <p v-if="!Object.keys(selectedEvent.metadata).length">
              Aucune métadonnée publique pour cet événement.
            </p>
            <dl v-else>
              <div v-for="(value, key) in selectedEvent.metadata" :key="key">
                <dt>{{ key }}</dt>
                <dd>{{ value ?? "—" }}</dd>
              </div>
            </dl>
          </section>
        </article>
        <div v-else class="audit-detail audit-detail--empty">
          <p>
            Sélectionnez un événement pour lire sa corrélation, sa portée et ses métadonnées
            autorisées.
          </p>
        </div>
      </section>

      <section class="audit-export" aria-labelledby="audit-export-title">
        <div>
          <h2 id="audit-export-title">Exporter la recherche</h2>
          <p>
            Portée : {{ selectedScopeLabel }}. Le fichier reprend les filtres actuels et reste
            limité à 10 000 lignes.
          </p>
        </div>
        <form method="post" @submit.prevent="exportEvents">
          <label class="confirmation">
            <input v-model="confirmExport" type="checkbox" />
            <span>Je confirme la génération auditée de ce CSV masqué.</span>
          </label>
          <MfaCodeField
            id="audit-export-code"
            v-model="exportCode"
            label="Code MFA pour exporter"
          />
          <p
            v-if="exportMessage"
            :role="exportError ? 'alert' : 'status'"
            :class="['form-message', { 'form-message--error': exportError }]"
            aria-live="polite"
          >
            {{ exportMessage }}
          </p>
          <button
            type="submit"
            :aria-busy="exportPending"
            :disabled="exportPending || !confirmExport || !validTotpCode(exportCode)"
          >
            {{ exportPending ? "Génération…" : "Télécharger le CSV" }}
          </button>
        </form>
      </section>
    </template>
  </section>
</template>
