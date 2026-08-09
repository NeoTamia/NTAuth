<script setup lang="ts">
import type { PolicyDocument, PolicyEffect, PolicyStatement } from "@neotamia/permissions";

import { authErrorMessage } from "~/utils/auth";
import {
  emptyPolicyDocument,
  identifierLines,
  parsePolicyJson,
  policyDiff,
  policyJson,
  validateEditablePolicy,
} from "~/utils/policies";

definePageMeta({ layout: "admin" });
useHead({ title: "Policies IAM — NTAuth" });

type LoadState = "locked" | "loading" | "ready" | "empty" | "error" | "forbidden";
type OrganizationSummary = { id: string; name: string; slug: string; status: string };
type CatalogueEntry = { description: string | null; identifier: string };
type Catalogue = {
  actions: CatalogueEntry[];
  resources: CatalogueEntry[];
  service: { key: string; name: string };
};
type PolicySummary = {
  currentVersion: number;
  id: string;
  name: string;
  organizationId: string;
  service: string;
  status: "active" | "inactive";
  updatedAt: string;
};
type PolicyVersion = {
  createdAt: string;
  document: PolicyDocument;
  documentHash: string;
  sourceVersion: number | null;
  version: number;
};
type PolicyHistory = { policy: PolicySummary; versions: PolicyVersion[] };

const { request } = useAuthApi();
const { challengeHeaders, challengeReady } = useMfaChallenge();
const organizations = ref<OrganizationSummary[]>([]);
const organizationState = ref<LoadState>("locked");
const organizationCode = ref("");
const organizationError = ref("");
const organizationId = ref("");

const service = ref("");
const workspaceCode = ref("");
const workspaceState = ref<LoadState>("locked");
const workspaceError = ref("");
const catalogue = ref<Catalogue | null>(null);
const policies = ref<PolicySummary[]>([]);

const selectedPolicy = ref<PolicySummary | null>(null);
const history = ref<PolicyVersion[]>([]);
const historyState = ref<LoadState>("locked");
const historyCode = ref("");
const historyError = ref("");

const policyName = ref("");
const draft = ref<PolicyDocument>(emptyPolicyDocument());
const baseline = ref<PolicyDocument>();
const jsonSource = ref(policyJson(draft.value));
const jsonIssues = ref<{ message: string; path: string }[]>([]);
const editorMode = ref<"visual" | "json">("visual");
const saveCode = ref("");
const savePending = ref(false);
const saveMessage = ref("");
const saveError = ref(false);
const editorTitle = ref<HTMLElement | null>(null);

const validationContext = computed(() => ({
  actions: new Set(catalogue.value?.actions.map(({ identifier }) => identifier) ?? []),
  expectedService: catalogue.value?.service.key,
  resources: new Set(catalogue.value?.resources.map(({ identifier }) => identifier) ?? []),
}));
const validation = computed(() => validateEditablePolicy(draft.value, validationContext.value));
const editorIssues = computed(() =>
  editorMode.value === "json" && jsonIssues.value.length
    ? jsonIssues.value
    : validation.value.issues,
);
const changes = computed(() => policyDiff(baseline.value, draft.value));
const canSave = computed(
  () =>
    Boolean(validation.value.document) &&
    policyName.value.trim().length > 0 &&
    challengeReady(saveCode.value) &&
    !savePending.value,
);

function safeError(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { code?: string };
    status?: number;
    statusCode?: number;
  };
  if (candidate.data?.code === "policy_conflict")
    return "Cette policy a changé depuis son ouverture. Rechargez son historique avant de réessayer.";
  if (candidate.data?.code === "invalid_policy")
    return "Le serveur a refusé le document : vérifiez le catalogue et les erreurs inline.";
  if (candidate.data?.code === "catalogue_not_found")
    return "Aucun catalogue actif ne correspond à cette clé. Créez d’abord le service et ses actions ou ressources.";
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Le code MFA est invalide, expiré ou cette portée ne vous est pas autorisée.";
  return authErrorMessage(error, fallback);
}

async function unlockOrganizations() {
  if (!challengeReady(organizationCode.value)) return;
  organizationState.value = "loading";
  organizationError.value = "";
  try {
    organizations.value =
      (await request<OrganizationSummary[]>("/api/v1/organizations", {
        headers: challengeHeaders(organizationCode.value),
      })) ?? [];
    organizationState.value = organizations.value.length ? "ready" : "empty";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    organizationState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    organizationError.value = safeError(error, "Les organisations ne peuvent pas être chargées.");
  } finally {
    organizationCode.value = "";
  }
}

function changeOrganization() {
  workspaceState.value = "locked";
  catalogue.value = null;
  policies.value = [];
  selectedPolicy.value = null;
  historyState.value = "locked";
  workspaceError.value = "";
}

async function loadWorkspace() {
  if (!organizationId.value || !/^[a-z][a-z0-9-]{0,62}$/.test(service.value)) return;
  if (!challengeReady(workspaceCode.value)) return;
  workspaceState.value = "loading";
  workspaceError.value = "";
  selectedPolicy.value = null;
  historyState.value = "locked";
  try {
    const query = new URLSearchParams({
      organization_id: organizationId.value,
      service: service.value,
    });
    const [loadedCatalogue, loadedPolicies] = await Promise.all([
      request<Catalogue>(`/api/v1/iam/catalog/${encodeURIComponent(service.value)}`),
      request<PolicySummary[]>(`/api/v1/iam/policies?${query}`, {
        headers: challengeHeaders(workspaceCode.value),
      }),
    ]);
    catalogue.value = loadedCatalogue;
    policies.value = loadedPolicies ?? [];
    workspaceState.value = policies.value.length ? "ready" : "empty";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    workspaceState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    workspaceError.value = safeError(error, "L’espace de policies ne peut pas être chargé.");
  } finally {
    workspaceCode.value = "";
  }
}

async function focusEditor() {
  await nextTick();
  editorTitle.value?.focus();
  editorTitle.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createDraft() {
  selectedPolicy.value = null;
  history.value = [];
  historyState.value = "ready";
  policyName.value = "";
  baseline.value = undefined;
  draft.value = emptyPolicyDocument();
  jsonSource.value = policyJson(draft.value);
  jsonIssues.value = [];
  saveMessage.value = "";
  await focusEditor();
}

function selectPolicy(policy: PolicySummary) {
  selectedPolicy.value = policy;
  history.value = [];
  historyState.value = "locked";
  historyCode.value = "";
  historyError.value = "";
  policyName.value = policy.name;
  baseline.value = undefined;
  saveMessage.value = "";
}

async function loadHistory() {
  if (!selectedPolicy.value || !challengeReady(historyCode.value)) return;
  historyState.value = "loading";
  historyError.value = "";
  try {
    const result = await request<PolicyHistory>(
      `/api/v1/iam/policies/${selectedPolicy.value.id}/history`,
      { headers: challengeHeaders(historyCode.value) },
    );
    selectedPolicy.value = result.policy;
    history.value = result.versions;
    const current = result.versions.find(({ version }) => version === result.policy.currentVersion);
    if (!current) throw new Error("current policy version missing");
    baseline.value = structuredClone(current.document);
    draft.value = structuredClone(current.document);
    jsonSource.value = policyJson(draft.value);
    jsonIssues.value = [];
    historyState.value = "ready";
    await focusEditor();
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    historyState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    historyError.value = safeError(error, "L’historique de la policy ne peut pas être chargé.");
  } finally {
    historyCode.value = "";
  }
}

function syncVisualEditor() {
  jsonSource.value = policyJson(draft.value);
  jsonIssues.value = [];
  saveMessage.value = "";
}

function updateIdentifiers(index: number, key: "actions" | "resources", value: string) {
  const statement = draft.value.statements[index];
  if (!statement) return;
  statement[key] = identifierLines(value);
  syncVisualEditor();
}

function addStatement() {
  draft.value.statements.push({ actions: [], effect: "Allow", resources: [] });
  syncVisualEditor();
}

function removeStatement(index: number) {
  draft.value.statements.splice(index, 1);
  syncVisualEditor();
}

function updateEffect(statement: PolicyStatement, value: Event) {
  statement.effect = (value.target as HTMLSelectElement).value as PolicyEffect;
  syncVisualEditor();
}

function applyJson() {
  const result = parsePolicyJson(jsonSource.value, validationContext.value);
  jsonIssues.value = result.issues;
  if (result.document) draft.value = structuredClone(result.document);
  saveMessage.value = "";
}

async function savePolicy() {
  if (!canSave.value || !validation.value.document || !catalogue.value) return;
  savePending.value = true;
  saveMessage.value = "";
  saveError.value = false;
  try {
    const result = selectedPolicy.value
      ? await request<{ policy: PolicySummary; version: PolicyVersion }>(
          `/api/v1/iam/policies/${selectedPolicy.value.id}`,
          {
            body: {
              document: validation.value.document,
              expectedVersion: selectedPolicy.value.currentVersion,
            },
            headers: challengeHeaders(saveCode.value),
            method: "PUT",
          },
        )
      : await request<{ policy: PolicySummary; version: PolicyVersion }>("/api/v1/iam/policies", {
          body: {
            document: validation.value.document,
            name: policyName.value.trim(),
            organizationId: organizationId.value,
            service: catalogue.value.service.key,
          },
          headers: challengeHeaders(saveCode.value),
          method: "POST",
        });
    selectedPolicy.value = result.policy;
    const index = policies.value.findIndex(({ id }) => id === result.policy.id);
    if (index === -1) policies.value.push(result.policy);
    else policies.value[index] = result.policy;
    policies.value.sort((left, right) => left.name.localeCompare(right.name, "fr"));
    history.value = [...history.value, result.version].toSorted(
      (left, right) => left.version - right.version,
    );
    historyState.value = "ready";
    baseline.value = structuredClone(result.version.document);
    draft.value = structuredClone(result.version.document);
    jsonSource.value = policyJson(draft.value);
    workspaceState.value = "ready";
    saveMessage.value = `Version ${result.version.version} enregistrée et auditée.`;
  } catch (error) {
    saveError.value = true;
    saveMessage.value = safeError(error, "La policy n’a pas pu être enregistrée.");
  } finally {
    saveCode.value = "";
    savePending.value = false;
  }
}
</script>

<template>
  <section class="policy-admin" aria-labelledby="policies-title">
    <header class="policy-admin__header">
      <div>
        <h1 id="policies-title">Éditeur de policies</h1>
        <p>Composez une autorisation lisible, puis vérifiez son contrat JSON avant publication.</p>
      </div>
      <dl class="assurance-list">
        <div>
          <dt>Validation</dt>
          <dd>Schéma et catalogue actifs vérifiés avant écriture</dd>
        </div>
        <div>
          <dt>Concurrence</dt>
          <dd>Chaque version part de la révision actuellement ouverte</dd>
        </div>
        <div>
          <dt>Traçabilité</dt>
          <dd>Lecture, création et versionnement sont audités</dd>
        </div>
      </dl>
    </header>

    <section
      v-if="organizationState === 'locked'"
      class="access-gate"
      aria-labelledby="policy-org-gate"
    >
      <h2 id="policy-org-gate">Choisir une portée protégée</h2>
      <p>Une session d’administration active protège la liste des tenants que vous administrez.</p>
      <form method="post" @submit.prevent="unlockOrganizations">
        <MfaCodeField
          id="policy-organization-code"
          v-model="organizationCode"
          label="Code MFA à 6 chiffres"
        />
        <button type="submit" :disabled="!challengeReady(organizationCode)">
          Afficher les tenants
        </button>
      </form>
    </section>
    <LoadingSkeleton
      v-else-if="organizationState === 'loading'"
      label="Chargement des tenants autorisés"
    />
    <div
      v-else-if="organizationState === 'error' || organizationState === 'forbidden'"
      class="state-panel state-panel--error"
      role="alert"
    >
      <h2>{{ organizationState === "forbidden" ? "Accès refusé" : "Chargement interrompu" }}</h2>
      <p>{{ organizationError }}</p>
      <button type="button" @click="organizationState = 'locked'">
        Réessayer avec un nouveau code
      </button>
    </div>
    <div v-else-if="organizationState === 'empty'" class="state-panel">
      <h2>Aucun tenant administrable</h2>
      <p>Une organisation et un rôle owner ou admin sont nécessaires.</p>
    </div>

    <template v-else>
      <section class="policy-scope" aria-labelledby="policy-scope-title">
        <div>
          <h2 id="policy-scope-title">Portée de travail</h2>
          <p>Le catalogue fixe les actions et ressources admises par le schéma.</p>
        </div>
        <form method="post" @submit.prevent="loadWorkspace">
          <div class="inline-fields">
            <div class="field">
              <label for="policy-organization">Organisation</label>
              <select
                id="policy-organization"
                v-model="organizationId"
                required
                @change="changeOrganization"
              >
                <option value="" disabled>Sélectionner un tenant</option>
                <option
                  v-for="organization in organizations"
                  :key="organization.id"
                  :value="organization.id"
                >
                  {{ organization.name }} — {{ organization.slug }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="policy-service">Clé du service</label>
              <input
                id="policy-service"
                v-model.trim="service"
                required
                pattern="[a-z][a-z0-9\-]{0,62}"
                placeholder="ntscout"
                @input="workspaceState = 'locked'"
              />
            </div>
          </div>
          <MfaCodeField
            id="policy-workspace-code"
            v-model="workspaceCode"
            label="Code MFA pour lister les policies"
          />
          <button
            type="submit"
            :disabled="!organizationId || !service || !challengeReady(workspaceCode)"
          >
            Charger le catalogue et les policies
          </button>
        </form>
      </section>

      <LoadingSkeleton
        v-if="workspaceState === 'loading'"
        label="Chargement du catalogue et des policies"
        :lines="4"
      />
      <div
        v-else-if="workspaceState === 'error' || workspaceState === 'forbidden'"
        class="state-panel state-panel--error"
        role="alert"
      >
        <h2>{{ workspaceState === "forbidden" ? "Portée interdite" : "Espace indisponible" }}</h2>
        <p>{{ workspaceError }}</p>
        <button type="button" @click="workspaceState = 'locked'">Réessayer</button>
      </div>

      <section
        v-else-if="workspaceState === 'ready' || workspaceState === 'empty'"
        class="policy-workspace"
      >
        <aside class="policy-register" aria-labelledby="policy-register-title">
          <header>
            <div>
              <h2 id="policy-register-title">Policies</h2>
              <p v-if="catalogue">{{ catalogue.service.name }}</p>
            </div>
            <button type="button" @click="createDraft">Nouvelle</button>
          </header>
          <p v-if="workspaceState === 'empty'" class="empty-line">
            Aucune policy pour cette portée.
          </p>
          <ul v-else class="policy-list">
            <li v-for="policy in policies" :key="policy.id">
              <button
                type="button"
                :aria-current="selectedPolicy?.id === policy.id ? 'true' : undefined"
                @click="selectPolicy(policy)"
              >
                <span
                  ><strong>{{ policy.name }}</strong
                  ><small>{{ policy.service }} · v{{ policy.currentVersion }}</small></span
                >
                <span
                  :class="[
                    'policy-status',
                    { 'policy-status--inactive': policy.status === 'inactive' },
                  ]"
                  >{{ policy.status === "active" ? "Active" : "Inactive" }}</span
                >
              </button>
            </li>
          </ul>
          <div v-if="catalogue" class="catalogue-summary">
            <h3>Catalogue actif</h3>
            <p>
              {{ catalogue.actions.length }} actions · {{ catalogue.resources.length }} ressources
            </p>
          </div>
        </aside>

        <section
          v-if="selectedPolicy && historyState === 'locked'"
          class="policy-history-gate"
          aria-labelledby="policy-history-gate-title"
        >
          <h2 id="policy-history-gate-title">Ouvrir {{ selectedPolicy.name }}</h2>
          <p>La dernière version et son historique exigent une nouvelle preuve MFA.</p>
          <form method="post" @submit.prevent="loadHistory">
            <MfaCodeField
              id="policy-history-code"
              v-model="historyCode"
              label="Code MFA pour cet historique"
            />
            <button type="submit" :disabled="!challengeReady(historyCode)">Ouvrir la policy</button>
          </form>
        </section>
        <LoadingSkeleton
          v-else-if="historyState === 'loading'"
          label="Chargement de l’historique immuable"
          :lines="4"
        />
        <div
          v-else-if="historyState === 'error' || historyState === 'forbidden'"
          class="state-panel state-panel--error"
          role="alert"
        >
          <h2>Policy inaccessible</h2>
          <p>{{ historyError }}</p>
          <button type="button" @click="historyState = 'locked'">Réessayer</button>
        </div>

        <article
          v-else-if="historyState === 'ready'"
          class="policy-editor"
          aria-labelledby="policy-editor-title"
        >
          <header class="policy-editor__heading">
            <div>
              <p>
                {{
                  selectedPolicy
                    ? `Version courante ${selectedPolicy.currentVersion}`
                    : "Nouvelle policy"
                }}
              </p>
              <h2 id="policy-editor-title" ref="editorTitle" tabindex="-1">
                {{ selectedPolicy?.name || "Policy sans nom" }}
              </h2>
            </div>
            <div class="view-switch" role="group" aria-label="Vue de l’éditeur">
              <button
                type="button"
                :aria-pressed="editorMode === 'visual'"
                @click="editorMode = 'visual'"
              >
                Visuelle
              </button>
              <button
                type="button"
                :aria-pressed="editorMode === 'json'"
                @click="editorMode = 'json'"
              >
                JSON
              </button>
            </div>
          </header>

          <div class="field">
            <label for="policy-name">Nom de la policy</label
            ><input
              id="policy-name"
              v-model="policyName"
              :disabled="Boolean(selectedPolicy)"
              required
              maxlength="160"
            />
          </div>

          <div v-if="editorMode === 'visual'" class="statement-editor">
            <section
              v-for="(statement, index) in draft.statements"
              :key="index"
              class="statement-card"
              :aria-labelledby="`statement-${index}-title`"
            >
              <header>
                <h3 :id="`statement-${index}-title`">Déclaration {{ index + 1 }}</h3>
                <button type="button" class="text-button" @click="removeStatement(index)">
                  Retirer
                </button>
              </header>
              <div class="inline-fields">
                <div class="field">
                  <label :for="`statement-${index}-sid`">Identifiant optionnel</label
                  ><input
                    :id="`statement-${index}-sid`"
                    v-model="statement.sid"
                    maxlength="64"
                    @input="syncVisualEditor"
                  />
                </div>
                <div class="field">
                  <label :for="`statement-${index}-effect`">Effet</label
                  ><select
                    :id="`statement-${index}-effect`"
                    :value="statement.effect"
                    @change="updateEffect(statement, $event)"
                  >
                    <option value="Allow">Allow — autoriser</option>
                    <option value="Deny">Deny — refuser</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label :for="`statement-${index}-actions`">Actions, une par ligne</label
                ><textarea
                  :id="`statement-${index}-actions`"
                  :value="statement.actions.join('\n')"
                  rows="4"
                  @input="
                    updateIdentifiers(
                      index,
                      'actions',
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                />
              </div>
              <div class="field">
                <label :for="`statement-${index}-resources`">Ressources, une par ligne</label
                ><textarea
                  :id="`statement-${index}-resources`"
                  :value="statement.resources.join('\n')"
                  rows="4"
                  @input="
                    updateIdentifiers(
                      index,
                      'resources',
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                />
              </div>
              <p v-if="statement.conditions" class="condition-note">
                Les conditions avancées de cette déclaration sont conservées et restent éditables
                dans la vue JSON.
              </p>
            </section>
            <button type="button" class="secondary-button" @click="addStatement">
              Ajouter une déclaration
            </button>
          </div>
          <div v-else class="json-editor">
            <label for="policy-json">Document JSON synchronisé</label>
            <textarea
              id="policy-json"
              v-model="jsonSource"
              rows="24"
              spellcheck="false"
              @input="applyJson"
            />
            <p>
              Le JSON valide remplace immédiatement la vue visuelle sans supprimer les conditions.
            </p>
          </div>

          <section class="policy-review" aria-labelledby="policy-review-title">
            <div>
              <h3 id="policy-review-title">Validation et différence</h3>
              <p>
                {{
                  editorIssues.length
                    ? `${editorIssues.length} erreur(s) empêchent l’enregistrement.`
                    : "Document valide pour le catalogue chargé."
                }}
              </p>
            </div>
            <ul v-if="editorIssues.length" class="validation-list" aria-live="polite">
              <li v-for="issue in editorIssues" :key="`${issue.path}-${issue.message}`">
                <code>{{ issue.path }}</code> {{ issue.message }}
              </li>
            </ul>
            <ul v-else class="diff-list">
              <li v-for="change in changes" :key="change">{{ change }}</li>
            </ul>
          </section>

          <section
            v-if="history.length"
            class="version-history"
            aria-labelledby="version-history-title"
          >
            <h3 id="version-history-title">Historique immuable</h3>
            <ol>
              <li v-for="version in [...history].reverse()" :key="version.version">
                <strong>v{{ version.version }}</strong
                ><span>{{ new Date(version.createdAt).toLocaleString("fr-FR") }}</span
                ><code>{{ version.documentHash.slice(0, 12) }}</code
                ><small v-if="version.sourceVersion"
                  >restaurée depuis v{{ version.sourceVersion }}</small
                >
              </li>
            </ol>
          </section>

          <form
            class="policy-save"
            aria-describedby="policy-save-message"
            method="post"
            @submit.prevent="savePolicy"
          >
            <MfaCodeField
              id="policy-save-code"
              v-model="saveCode"
              :disabled="savePending"
              label="Code MFA pour enregistrer cette version"
            />
            <p
              id="policy-save-message"
              :class="['form-message', { 'form-message--error': saveError }]"
              aria-live="polite"
            >
              {{
                saveMessage ||
                `Portée : ${catalogue?.service.key}, tenant sélectionné. Une nouvelle version auditée sera créée.`
              }}
            </p>
            <button type="submit" :aria-busy="savePending" :disabled="!canSave">
              {{
                savePending
                  ? "Enregistrement…"
                  : selectedPolicy
                    ? "Créer la version suivante"
                    : "Créer la policy"
              }}
            </button>
          </form>
        </article>

        <div v-else class="policy-placeholder">
          <p>Sélectionnez une policy ou créez-en une pour ouvrir l’éditeur.</p>
        </div>
      </section>
    </template>
  </section>
</template>
