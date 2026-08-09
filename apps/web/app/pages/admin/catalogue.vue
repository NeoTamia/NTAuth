<script setup lang="ts">
import { isPolicyIdentifier, type IamCatalogKind } from "@neotamia/permissions";

import { authErrorMessage } from "~/utils/auth";

definePageMeta({ layout: "admin" });
useHead({ title: "Catalogue IAM — NTAuth" });

type LoadState = "locked" | "loading" | "ready" | "error" | "forbidden";
type ServiceStatus = "active" | "inactive";
type CatalogueEntry = {
  createdAt: string;
  description: string | null;
  id: string;
  identifier: string;
  kind: IamCatalogKind;
  service: string;
  status: ServiceStatus;
  updatedAt: string;
};
type Service = {
  createdAt: string;
  entries: CatalogueEntry[];
  key: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  ownerUserId: string;
  status: ServiceStatus;
  updatedAt: string;
};
type UserSummary = { email: string; id: string; name: string; status: "active" };
type UserPage = { items: UserSummary[]; nextOffset: number | null; total: number };

const { request } = useAuthApi();
const { challengeHeaders, challengeReady } = useMfaChallenge();
const state = ref<LoadState>("locked");
const unlockCode = ref("");
const loadError = ref("");
const registryMessage = ref("");
const services = ref<Service[]>([]);
const owners = ref<UserSummary[]>([]);
const selectedKey = ref("");
const selected = computed(() => services.value.find(({ key }) => key === selectedKey.value));
const actionEntries = computed(() =>
  (selected.value?.entries ?? []).filter(({ kind }) => kind === "action"),
);
const resourceEntries = computed(() =>
  (selected.value?.entries ?? []).filter(({ kind }) => kind === "resource"),
);

const createOpen = ref(false);
const createKey = ref("");
const createName = ref("");
const createOwner = ref("");
const createCode = ref("");
const createPending = ref(false);
const createMessage = ref("");
const createError = ref(false);
const createTitle = ref<HTMLElement | null>(null);

const editName = ref("");
const editOwner = ref("");
const editStatus = ref<ServiceStatus>("active");
const editCode = ref("");
const editPending = ref(false);
const editMessage = ref("");
const editError = ref(false);

const entryKind = ref<IamCatalogKind>("action");
const entryIdentifier = ref("");
const entryDescription = ref("");
const entryCode = ref("");
const entryPending = ref(false);
const entryMessage = ref("");
const entryError = ref(false);
const toggledEntryId = ref("");

const canCreate = computed(
  () =>
    /^[a-z][a-z0-9-]{0,62}$/.test(createKey.value) &&
    createName.value.trim().length > 0 &&
    Boolean(createOwner.value) &&
    challengeReady(createCode.value) &&
    !createPending.value,
);
const canCreateEntry = computed(
  () =>
    Boolean(selected.value) &&
    isPolicyIdentifier(entryIdentifier.value, entryKind.value, selected.value?.key) &&
    entryDescription.value.length <= 500 &&
    challengeReady(entryCode.value) &&
    !entryPending.value,
);

function safeError(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { code?: string };
    status?: number;
    statusCode?: number;
  };
  if (candidate.data?.code === "catalogue_conflict")
    return "Cette clé ou cet identifiant existe déjà, ou son format ne correspond pas au service.";
  if (candidate.data?.code === "catalogue_not_found")
    return "Le service ou l’entrée n’existe plus. Rechargez le registre.";
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Cette opération est réservée aux administrateurs plateforme.";
  return authErrorMessage(error, fallback);
}

function ownerFor(userId: string) {
  return owners.value.find(({ id }) => id === userId);
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function loadActiveOwners(
  headers: Record<string, string>,
  offset = 0,
  loaded: UserSummary[] = [],
): Promise<UserSummary[]> {
  const page: UserPage = await request(`/api/v1/users?status=active&limit=50&offset=${offset}`, {
    headers,
  });
  loaded.push(...page.items);
  return page.nextOffset === null ? loaded : loadActiveOwners(headers, page.nextOffset, loaded);
}

function selectService(service: Service) {
  selectedKey.value = service.key;
  editName.value = service.name;
  editOwner.value = service.ownerUserId;
  editStatus.value = service.status;
  editMessage.value = "";
  entryKind.value = "action";
  entryIdentifier.value = `${service.key}:`;
  entryDescription.value = "";
  entryMessage.value = "";
}

async function unlockRegistry() {
  if (!challengeReady(unlockCode.value)) return;
  state.value = "loading";
  loadError.value = "";
  try {
    const headers = challengeHeaders(unlockCode.value);
    const [loadedServices, loadedOwners] = await Promise.all([
      request<Service[]>("/api/v1/iam/catalog", { headers }),
      loadActiveOwners(headers),
    ]);
    services.value = loadedServices ?? [];
    owners.value = loadedOwners;
    createOwner.value = loadedOwners[0]?.id ?? "";
    state.value = "ready";
    if (services.value[0]) selectService(services.value[0]);
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    state.value = candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    loadError.value = safeError(error, "Le catalogue IAM ne peut pas être chargé.");
  } finally {
    unlockCode.value = "";
  }
}

async function openCreation() {
  createOpen.value = true;
  createKey.value = "";
  createName.value = "";
  createOwner.value = owners.value[0]?.id ?? "";
  createMessage.value = "";
  await nextTick();
  createTitle.value?.focus();
  createTitle.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createService() {
  if (!canCreate.value) return;
  createPending.value = true;
  createMessage.value = "";
  createError.value = false;
  try {
    const created = await request<Omit<Service, "entries" | "ownerEmail" | "ownerName">>(
      "/api/v1/services",
      {
        body: {
          key: createKey.value,
          name: createName.value.trim(),
          ownerUserId: createOwner.value,
        },
        headers: challengeHeaders(createCode.value),
        method: "POST",
      },
    );
    const owner = ownerFor(created.ownerUserId);
    const service: Service = {
      ...created,
      entries: [],
      ownerEmail: owner?.email ?? created.ownerUserId,
      ownerName: owner?.name ?? "Utilisateur actif",
    };
    services.value = [...services.value, service].toSorted((left, right) =>
      left.name.localeCompare(right.name, "fr"),
    );
    selectService(service);
    createOpen.value = false;
    registryMessage.value = "Service créé et ajouté au registre.";
  } catch (error) {
    createError.value = true;
    createMessage.value = safeError(error, "Le service n’a pas pu être créé.");
  } finally {
    createCode.value = "";
    createPending.value = false;
  }
}

async function updateService() {
  if (!selected.value || !editName.value.trim() || !editOwner.value || editPending.value) return;
  if (!challengeReady(editCode.value)) return;
  editPending.value = true;
  editMessage.value = "";
  editError.value = false;
  try {
    const updated = await request<Omit<Service, "entries" | "ownerEmail" | "ownerName">>(
      `/api/v1/services/${encodeURIComponent(selected.value.key)}`,
      {
        body: {
          name: editName.value.trim(),
          ownerUserId: editOwner.value,
          status: editStatus.value,
        },
        headers: challengeHeaders(editCode.value),
        method: "PATCH",
      },
    );
    const owner = ownerFor(updated.ownerUserId);
    Object.assign(selected.value, updated, {
      ownerEmail: owner?.email ?? updated.ownerUserId,
      ownerName: owner?.name ?? "Utilisateur actif",
    });
    editMessage.value = "Service mis à jour et mutation auditée.";
  } catch (error) {
    editError.value = true;
    editMessage.value = safeError(error, "Le service n’a pas pu être mis à jour.");
  } finally {
    editCode.value = "";
    editPending.value = false;
  }
}

async function createEntry() {
  if (!selected.value || !canCreateEntry.value) return;
  entryPending.value = true;
  entryMessage.value = "";
  entryError.value = false;
  try {
    const created = await request<CatalogueEntry>("/api/v1/iam/catalog", {
      body: {
        description: entryDescription.value.trim() || undefined,
        identifier: entryIdentifier.value,
        kind: entryKind.value,
        service: selected.value.key,
      },
      headers: challengeHeaders(entryCode.value),
      method: "POST",
    });
    selected.value.entries = [...selected.value.entries, created].toSorted((left, right) =>
      left.identifier.localeCompare(right.identifier),
    );
    entryIdentifier.value = `${selected.value.key}:`;
    entryDescription.value = "";
    entryMessage.value = "Entrée ajoutée au catalogue actif.";
  } catch (error) {
    entryError.value = true;
    entryMessage.value = safeError(error, "L’entrée n’a pas pu être ajoutée.");
  } finally {
    entryCode.value = "";
    entryPending.value = false;
  }
}

async function toggleEntry(entry: CatalogueEntry) {
  if (!challengeReady(entryCode.value) || toggledEntryId.value) return;
  toggledEntryId.value = entry.id;
  entryMessage.value = "";
  entryError.value = false;
  try {
    const updated = await request<CatalogueEntry>(`/api/v1/iam/catalog/${entry.id}`, {
      body: { status: entry.status === "active" ? "inactive" : "active" },
      headers: challengeHeaders(entryCode.value),
      method: "PATCH",
    });
    Object.assign(entry, updated);
    entryMessage.value = `${entry.identifier} est maintenant ${entry.status === "active" ? "active" : "inactive"}.`;
  } catch (error) {
    entryError.value = true;
    entryMessage.value = safeError(error, "Le statut de l’entrée n’a pas pu être modifié.");
  } finally {
    entryCode.value = "";
    toggledEntryId.value = "";
  }
}
</script>

<template>
  <section class="catalogue-admin" aria-labelledby="catalogue-title">
    <!--
      THESIS: Le catalogue reste un registre visible pendant chaque mutation, jamais un assistant opaque.
      OWN-WORLD: Papier minéral, encre forestière, séparateurs plats et rouille réservée aux alertes.
      STORY: Ouvrir le registre, choisir ou créer un service, puis gouverner ses identifiants fermés.
      FIRST VIEWPORT: Contexte et garanties en tête, accès MFA, puis registre maître–détail.
      FORM: Split registry/detail, assigned structure 3, seed 90470187.
      FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
    -->
    <header class="catalogue-admin__header">
      <div>
        <h1 id="catalogue-title">Catalogue IAM</h1>
        <p>
          Déclarez les services producteurs, puis fermez leur vocabulaire d’actions et de ressources
          avant d’écrire une policy.
        </p>
      </div>
      <dl class="assurance-list">
        <div>
          <dt>Propriété</dt>
          <dd>Un utilisateur actif gouverne chaque service</dd>
        </div>
        <div>
          <dt>Contrat</dt>
          <dd>Les identifiants restent liés à une seule clé</dd>
        </div>
        <div>
          <dt>Effet</dt>
          <dd>Une entrée inactive est refusée par les policies</dd>
        </div>
      </dl>
    </header>

    <section v-if="state === 'locked'" class="catalogue-gate" aria-labelledby="catalogue-gate">
      <div>
        <h2 id="catalogue-gate">Ouvrir le registre global</h2>
        <p>La lecture administrative révèle les propriétaires et les entrées inactives.</p>
      </div>
      <form method="post" @submit.prevent="unlockRegistry">
        <MfaCodeField id="catalogue-unlock-code" v-model="unlockCode" label="Code MFA" />
        <button type="submit" :disabled="!challengeReady(unlockCode)">Charger le catalogue</button>
      </form>
    </section>
    <LoadingSkeleton
      v-else-if="state === 'loading'"
      label="Chargement du catalogue IAM"
      :lines="5"
    />
    <div v-else-if="state === 'error' || state === 'forbidden'" class="state-panel" role="alert">
      <p>{{ loadError }}</p>
      <button type="button" class="text-button" @click="state = 'locked'">Réessayer</button>
    </div>

    <template v-else>
      <section
        v-if="createOpen"
        class="catalogue-creation"
        aria-labelledby="catalogue-create-title"
      >
        <header>
          <div>
            <h2 id="catalogue-create-title" ref="createTitle" tabindex="-1">Nouveau service</h2>
            <p>La clé devient le préfixe immuable de chaque action et ressource.</p>
          </div>
          <button type="button" class="text-button" @click="createOpen = false">Fermer</button>
        </header>
        <form method="post" @submit.prevent="createService">
          <div class="inline-fields">
            <label class="field">
              <span>Clé immuable</span>
              <input
                v-model.trim="createKey"
                required
                pattern="[a-z][a-z0-9\-]{0,62}"
                placeholder="ntscout"
              />
            </label>
            <label class="field">
              <span>Nom</span>
              <input v-model="createName" required maxlength="160" placeholder="NTScout" />
            </label>
          </div>
          <label class="field">
            <span>Propriétaire actif</span>
            <select v-model="createOwner" required>
              <option v-for="owner in owners" :key="owner.id" :value="owner.id">
                {{ owner.name }} — {{ owner.email }}
              </option>
            </select>
          </label>
          <MfaCodeField
            id="catalogue-create-code"
            v-model="createCode"
            label="Code MFA pour créer"
          />
          <p
            v-if="createMessage"
            :class="['form-message', { 'form-message--error': createError }]"
            :role="createError ? 'alert' : 'status'"
          >
            {{ createMessage }}
          </p>
          <button type="submit" :disabled="!canCreate">
            {{ createPending ? "Création…" : "Créer le service" }}
          </button>
        </form>
      </section>

      <div class="catalogue-toolbar">
        <div>
          <h2>Services déclarés</h2>
          <p>{{ countLabel(services.length, "service") }}, y compris les services inactifs.</p>
          <p v-if="registryMessage" class="form-message" role="status" aria-live="polite">
            {{ registryMessage }}
          </p>
        </div>
        <button v-if="services.length" type="button" @click="openCreation">Nouveau service</button>
      </div>

      <div v-if="services.length" class="catalogue-workspace">
        <aside class="catalogue-register" aria-labelledby="catalogue-register-title">
          <header>
            <h2 id="catalogue-register-title">Registre</h2>
          </header>
          <ul class="catalogue-service-list">
            <li v-for="serviceItem in services" :key="serviceItem.key">
              <button
                type="button"
                :aria-current="selectedKey === serviceItem.key"
                @click="selectService(serviceItem)"
              >
                <span>
                  <strong>{{ serviceItem.name }}</strong>
                  <small>
                    {{ serviceItem.key }} · {{ countLabel(serviceItem.entries.length, "entrée") }}
                  </small>
                </span>
                <span
                  :class="[
                    'catalogue-status',
                    { 'catalogue-status--inactive': serviceItem.status === 'inactive' },
                  ]"
                >
                  {{ serviceItem.status === "active" ? "Actif" : "Inactif" }}
                </span>
              </button>
            </li>
          </ul>
        </aside>

        <article v-if="selected" class="catalogue-detail" aria-labelledby="catalogue-detail-title">
          <header>
            <div>
              <p>{{ selected.key }}</p>
              <h2 id="catalogue-detail-title">{{ selected.name }}</h2>
            </div>
            <span
              :class="[
                'catalogue-status',
                { 'catalogue-status--inactive': selected.status === 'inactive' },
              ]"
            >
              {{ selected.status === "active" ? "Service actif" : "Service inactif" }}
            </span>
          </header>

          <section class="catalogue-settings" aria-labelledby="catalogue-settings-title">
            <h3 id="catalogue-settings-title">Gouvernance du service</h3>
            <form method="post" @submit.prevent="updateService">
              <div class="inline-fields">
                <label class="field">
                  <span>Nom</span>
                  <input v-model="editName" required maxlength="160" />
                </label>
                <label class="field">
                  <span>Statut</span>
                  <select v-model="editStatus">
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                  </select>
                </label>
              </div>
              <label class="field">
                <span>Propriétaire actif</span>
                <select v-model="editOwner" required>
                  <option v-for="owner in owners" :key="owner.id" :value="owner.id">
                    {{ owner.name }} — {{ owner.email }}
                  </option>
                </select>
              </label>
              <MfaCodeField
                id="catalogue-edit-code"
                v-model="editCode"
                label="Code MFA pour modifier"
              />
              <p
                v-if="editMessage"
                :class="['form-message', { 'form-message--error': editError }]"
                :role="editError ? 'alert' : 'status'"
              >
                {{ editMessage }}
              </p>
              <button
                type="submit"
                :disabled="
                  editPending || !editName.trim() || !editOwner || !challengeReady(editCode)
                "
              >
                {{ editPending ? "Enregistrement…" : "Enregistrer la gouvernance" }}
              </button>
            </form>
          </section>

          <section class="catalogue-entry-creation" aria-labelledby="catalogue-entry-create-title">
            <header>
              <h3 id="catalogue-entry-create-title">Nouvelle entrée</h3>
              <p>
                Le serveur refuse tout identifiant hors du préfixe <code>{{ selected.key }}:</code>.
              </p>
            </header>
            <form method="post" @submit.prevent="createEntry">
              <div class="inline-fields">
                <label class="field">
                  <span>Type</span>
                  <select v-model="entryKind" @change="entryIdentifier = `${selected.key}:`">
                    <option value="action">Action</option>
                    <option value="resource">Ressource</option>
                  </select>
                </label>
                <label class="field">
                  <span>Identifiant complet</span>
                  <input
                    v-model.trim="entryIdentifier"
                    required
                    maxlength="256"
                    :placeholder="
                      entryKind === 'action'
                        ? `${selected.key}:report:read`
                        : `${selected.key}:report:*`
                    "
                  />
                </label>
              </div>
              <label class="field">
                <span>Description optionnelle</span>
                <textarea v-model="entryDescription" maxlength="500" rows="3" />
              </label>
              <MfaCodeField
                id="catalogue-entry-code"
                v-model="entryCode"
                label="Code MFA pour le catalogue"
              />
              <p
                v-if="entryMessage"
                :class="['form-message', { 'form-message--error': entryError }]"
                :role="entryError ? 'alert' : 'status'"
                aria-live="polite"
              >
                {{ entryMessage }}
              </p>
              <button type="submit" :disabled="!canCreateEntry">
                {{ entryPending ? "Ajout…" : "Ajouter l’entrée" }}
              </button>
            </form>
          </section>

          <div class="catalogue-entry-columns">
            <section aria-labelledby="catalogue-actions-title">
              <header>
                <h3 id="catalogue-actions-title">Actions</h3>
                <span>{{ actionEntries.length }}</span>
              </header>
              <p v-if="!actionEntries.length" class="empty-line">Aucune action déclarée.</p>
              <ul v-else class="catalogue-entry-list">
                <li v-for="entry in actionEntries" :key="entry.id">
                  <div>
                    <strong>{{ entry.identifier }}</strong>
                    <small>{{ entry.description || "Sans description" }}</small>
                  </div>
                  <button
                    type="button"
                    class="text-button"
                    :disabled="toggledEntryId === entry.id || !challengeReady(entryCode)"
                    @click="toggleEntry(entry)"
                  >
                    {{ entry.status === "active" ? "Désactiver" : "Réactiver" }}
                  </button>
                </li>
              </ul>
            </section>
            <section aria-labelledby="catalogue-resources-title">
              <header>
                <h3 id="catalogue-resources-title">Ressources</h3>
                <span>{{ resourceEntries.length }}</span>
              </header>
              <p v-if="!resourceEntries.length" class="empty-line">Aucune ressource déclarée.</p>
              <ul v-else class="catalogue-entry-list">
                <li v-for="entry in resourceEntries" :key="entry.id">
                  <div>
                    <strong>{{ entry.identifier }}</strong>
                    <small>{{ entry.description || "Sans description" }}</small>
                  </div>
                  <button
                    type="button"
                    class="text-button"
                    :disabled="toggledEntryId === entry.id || !challengeReady(entryCode)"
                    @click="toggleEntry(entry)"
                  >
                    {{ entry.status === "active" ? "Désactiver" : "Réactiver" }}
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </article>
      </div>

      <section v-else class="catalogue-empty" aria-labelledby="catalogue-empty-title">
        <h2 id="catalogue-empty-title">Aucun service déclaré</h2>
        <p>Créez le premier service avant d’ouvrir l’éditeur de policies ou d’accorder un accès.</p>
        <button type="button" @click="openCreation">Créer le premier service</button>
      </section>
    </template>
  </section>
</template>
