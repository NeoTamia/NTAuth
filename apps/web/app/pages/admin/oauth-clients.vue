<script setup lang="ts">
import { authErrorMessage } from "~/utils/auth";
import { mfaChallengeHeaders, validTotpCode } from "~/utils/mfa";
import {
  clientKind,
  clientPayload,
  normalizeRedirectUris,
  OAUTH_SCOPES,
  type OAuthClientKind,
} from "~/utils/oauth-clients";

definePageMeta({ layout: "admin" });
useHead({ title: "Applications OAuth — NTAuth" });

type OAuthClient = {
  client_id: string;
  client_name?: string;
  disabled?: boolean;
  grant_types?: string[];
  public?: boolean;
  redirect_uris: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
  type?: string;
};

const { request } = useAuthApi();
const clients = ref<OAuthClient[]>([]);
const listCode = ref("");
const listState = ref<"locked" | "loading" | "ready" | "error" | "forbidden">("locked");
const listError = ref("");
const createOpen = ref(false);
const createPending = ref(false);
const createError = ref("");
const createdSecret = ref("");
const createdClientId = ref("");
const name = ref("");
const kind = ref<OAuthClientKind>("public");
const redirectUris = ref("");
const selectedScopes = ref<string[]>([...OAUTH_SCOPES]);
const createCode = ref("");
const selected = ref<OAuthClient | null>(null);
const editRedirectUris = ref("");
const actionCode = ref("");
const actionPending = ref<"update" | "rotate" | "delete" | "">("");
const actionError = ref("");
const rotatedSecret = ref("");
const confirmDelete = ref(false);
const createTitle = ref<HTMLElement | null>(null);

const canCreate = computed(
  () =>
    name.value.trim().length > 0 &&
    redirectUris.value.trim().length > 0 &&
    validTotpCode(createCode.value) &&
    !createPending.value,
);
const canAct = computed(() => validTotpCode(actionCode.value) && !actionPending.value);

function safeError(error: unknown, fallback: string) {
  const candidate = error as { status?: number; statusCode?: number };
  if (candidate.status === 401 || candidate.statusCode === 401)
    return "Le code MFA est invalide, expiré ou déjà utilisé.";
  if (candidate.status === 403 || candidate.statusCode === 403)
    return "Cette action est réservée aux administrateurs plateforme.";
  return authErrorMessage(error, fallback);
}

async function unlockRegistry() {
  if (!validTotpCode(listCode.value)) return;
  listState.value = "loading";
  listError.value = "";
  try {
    clients.value =
      (await request<OAuthClient[]>("/api/auth/oauth2/get-clients", {
        headers: mfaChallengeHeaders(listCode.value),
      })) ?? [];
    listState.value = "ready";
  } catch (error) {
    const candidate = error as { status?: number; statusCode?: number };
    listState.value =
      candidate.status === 403 || candidate.statusCode === 403 ? "forbidden" : "error";
    listError.value = safeError(error, "Le registre OAuth ne peut pas être chargé.");
  } finally {
    listCode.value = "";
  }
}

async function openCreation() {
  createdSecret.value = "";
  createdClientId.value = "";
  createError.value = "";
  createOpen.value = true;
  await nextTick();
  createTitle.value?.focus();
  createTitle.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createClient() {
  if (!canCreate.value) return;
  createPending.value = true;
  createError.value = "";
  createdSecret.value = "";
  try {
    const created = await request<OAuthClient & { client_secret?: string }>(
      "/api/auth/oauth2/create-client",
      {
        body: clientPayload({
          kind: kind.value,
          name: name.value,
          redirectUris: redirectUris.value,
          scopes: selectedScopes.value,
        }),
        headers: mfaChallengeHeaders(createCode.value),
        method: "POST",
      },
    );
    clients.value = [created, ...clients.value];
    createdClientId.value = created.client_id;
    createdSecret.value = created.client_secret ?? "";
    name.value = "";
    redirectUris.value = "";
  } catch (error) {
    createError.value =
      error instanceof Error && error.message.endsWith("redirect_uri")
        ? "Chaque URI doit être une URL HTTP(S) exacte, sans wildcard, identifiants ni fragment."
        : safeError(error, "L’application OAuth n’a pas pu être créée.");
  } finally {
    createCode.value = "";
    createPending.value = false;
  }
}

function selectClient(client: OAuthClient) {
  selected.value = client;
  editRedirectUris.value = client.redirect_uris.join("\n");
  actionCode.value = "";
  actionError.value = "";
  rotatedSecret.value = "";
  confirmDelete.value = false;
}

async function updateClient() {
  if (!selected.value || !canAct.value) return;
  actionPending.value = "update";
  actionError.value = "";
  try {
    const uris = normalizeRedirectUris(editRedirectUris.value);
    await request("/api/auth/oauth2/update-client", {
      body: { client_id: selected.value.client_id, update: { redirect_uris: uris } },
      headers: mfaChallengeHeaders(actionCode.value),
      method: "POST",
    });
    selected.value.redirect_uris = uris;
  } catch (error) {
    actionError.value =
      error instanceof Error && error.message.endsWith("redirect_uri")
        ? "Chaque URI doit être une URL HTTP(S) exacte et sans wildcard."
        : safeError(error, "Les URI n’ont pas pu être mises à jour.");
  } finally {
    actionCode.value = "";
    actionPending.value = "";
  }
}

async function rotateSecret() {
  if (!selected.value || clientKind(selected.value) === "public" || !canAct.value) return;
  actionPending.value = "rotate";
  actionError.value = "";
  rotatedSecret.value = "";
  try {
    const result = await request<{ client_secret: string }>(
      "/api/auth/oauth2/client/rotate-secret",
      {
        body: { client_id: selected.value.client_id },
        headers: mfaChallengeHeaders(actionCode.value),
        method: "POST",
      },
    );
    rotatedSecret.value = result.client_secret;
  } catch (error) {
    actionError.value = safeError(error, "Le secret n’a pas pu être renouvelé.");
  } finally {
    actionCode.value = "";
    actionPending.value = "";
  }
}

async function deleteClient() {
  if (!selected.value || !canAct.value || !confirmDelete.value) return;
  actionPending.value = "delete";
  actionError.value = "";
  try {
    await request("/api/auth/oauth2/delete-client", {
      body: { client_id: selected.value.client_id },
      headers: mfaChallengeHeaders(actionCode.value),
      method: "POST",
    });
    clients.value = clients.value.filter(
      (client) => client.client_id !== selected.value?.client_id,
    );
    selected.value = null;
  } catch (error) {
    actionError.value = safeError(error, "L’application n’a pas pu être supprimée.");
  } finally {
    actionCode.value = "";
    confirmDelete.value = false;
    actionPending.value = "";
  }
}
</script>

<template>
  <section class="oauth-admin" aria-labelledby="oauth-clients-title">
    <header class="oauth-admin__header">
      <div>
        <h1 id="oauth-clients-title">Applications OAuth</h1>
        <p>Déclarez les intégrations autorisées à demander une identité NTAuth.</p>
      </div>
      <button v-if="listState === 'ready'" type="button" @click="openCreation">
        Nouvelle application
      </button>
    </header>

    <dl class="security-scope" aria-label="Garanties du registre OAuth">
      <div>
        <dt>Autorisation</dt>
        <dd>Administrateur plateforme avec MFA</dd>
      </div>
      <div>
        <dt>Redirections</dt>
        <dd>Correspondance exacte, aucun wildcard</dd>
      </div>
      <div>
        <dt>Traçabilité</dt>
        <dd>Lecture et mutations auditées côté serveur</dd>
      </div>
    </dl>

    <section
      v-if="listState !== 'ready'"
      class="registry-gate"
      aria-labelledby="registry-gate-title"
    >
      <h2 id="registry-gate-title">Ouvrir le registre protégé</h2>
      <p>Un code à usage unique est requis pour consulter les métadonnées des applications.</p>
      <form
        method="post"
        aria-describedby="registry-gate-guidance"
        @submit.prevent="unlockRegistry"
      >
        <MfaCodeField id="oauth-list-code" v-model="listCode" :disabled="listState === 'loading'" />
        <p
          v-if="listError"
          id="registry-gate-guidance"
          class="form-message form-message--error"
          role="alert"
        >
          {{ listError }}
        </p>
        <p v-else id="registry-gate-guidance" class="form-guidance">
          Le code est vérifié par le serveur et ne peut pas être rejoué.
        </p>
        <button
          type="submit"
          :disabled="!validTotpCode(listCode) || listState === 'loading'"
          :aria-busy="listState === 'loading'"
        >
          {{ listState === "loading" ? "Ouverture…" : "Vérifier et ouvrir" }}
        </button>
      </form>
    </section>

    <template v-else>
      <div v-if="clients.length" class="oauth-workspace">
        <section aria-labelledby="oauth-list-title">
          <h2 id="oauth-list-title">Registre</h2>
          <ul class="oauth-client-list">
            <li v-for="client in clients" :key="client.client_id">
              <button
                type="button"
                :aria-current="selected?.client_id === client.client_id ? 'true' : undefined"
                @click="selectClient(client)"
              >
                <span>{{ client.client_name || "Application sans nom" }}</span>
                <small>{{
                  clientKind(client) === "public" ? "Public + PKCE" : "Confidentiel"
                }}</small>
                <code>{{ client.client_id }}</code>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="selected" class="oauth-detail" aria-labelledby="oauth-detail-title">
          <header>
            <div>
              <span>Application sélectionnée</span>
              <h2 id="oauth-detail-title">{{ selected.client_name || "Application sans nom" }}</h2>
            </div>
            <button type="button" class="text-button" @click="selected = null">Fermer</button>
          </header>
          <p class="client-kind">
            {{
              clientKind(selected) === "public"
                ? "Client public — secret interdit, PKCE requis"
                : "Client confidentiel — secret serveur"
            }}
          </p>
          <div class="field">
            <label for="oauth-edit-uris">URI de redirection exactes, une par ligne</label>
            <textarea id="oauth-edit-uris" v-model="editRedirectUris" rows="5" spellcheck="false" />
          </div>
          <MfaCodeField
            id="oauth-action-code"
            v-model="actionCode"
            :disabled="Boolean(actionPending)"
            label="Nouveau code MFA pour l’action"
            described-by="oauth-action-scope"
          />
          <p id="oauth-action-scope" class="form-guidance">
            Le code autorise uniquement l’action choisie ci-dessous.
          </p>
          <p v-if="actionError" class="form-message form-message--error" role="alert">
            {{ actionError }}
          </p>
          <div v-if="rotatedSecret" class="secret-reveal" role="status">
            <strong>Nouveau secret — copiez-le maintenant</strong>
            <code>{{ rotatedSecret }}</code>
            <p>Il ne sera plus affiché après fermeture de cette fiche.</p>
          </div>
          <div class="oauth-actions">
            <button type="button" :disabled="!canAct" @click="updateClient">
              {{ actionPending === "update" ? "Enregistrement…" : "Enregistrer les URI" }}
            </button>
            <button
              v-if="clientKind(selected) === 'confidential'"
              type="button"
              class="secondary-button"
              :disabled="!canAct"
              @click="rotateSecret"
            >
              {{ actionPending === "rotate" ? "Rotation…" : "Renouveler le secret" }}
            </button>
            <label class="destructive-confirmation">
              <input v-model="confirmDelete" type="checkbox" />
              Je confirme la suppression définitive de
              {{ selected.client_name || "ce client" }}.
            </label>
            <button
              type="button"
              class="danger-button"
              :disabled="!canAct || !confirmDelete"
              @click="deleteClient"
            >
              {{ actionPending === "delete" ? "Suppression…" : "Supprimer définitivement" }}
            </button>
          </div>
        </section>
        <aside
          v-else
          class="oauth-detail oauth-detail--empty"
          aria-label="Aucune application sélectionnée"
        >
          <p>Sélectionnez une application pour vérifier sa portée ou modifier ses URI.</p>
        </aside>
      </div>
      <div v-else class="empty-state">
        <h2>Aucune application administrée</h2>
        <p>
          Créez le premier client OAuth. Son identifiant sera public ; un éventuel secret ne sera
          révélé qu’une fois.
        </p>
        <button type="button" @click="openCreation">Créer une application</button>
      </div>
    </template>

    <section v-if="createOpen" class="oauth-creation" aria-labelledby="oauth-create-title">
      <header>
        <div>
          <span>Nouvelle entrée</span>
          <h2 id="oauth-create-title" ref="createTitle" tabindex="-1">Déclarer une application</h2>
        </div>
        <button type="button" class="text-button" @click="createOpen = false">Fermer</button>
      </header>
      <div v-if="createdClientId" class="secret-reveal" role="status">
        <strong>Application créée</strong>
        <p>Identifiant</p>
        <code>{{ createdClientId }}</code>
        <template v-if="createdSecret">
          <p>Secret confidentiel — copiez-le maintenant</p>
          <code>{{ createdSecret }}</code>
          <p>NTAuth ne pourra pas le réafficher.</p>
        </template>
        <p v-else>Client public : aucun secret n’a été généré.</p>
      </div>
      <form
        v-else
        method="post"
        aria-describedby="oauth-create-guidance"
        @submit.prevent="createClient"
      >
        <div class="field">
          <label for="oauth-name">Nom de l’application</label
          ><input id="oauth-name" v-model="name" required autocomplete="off" />
        </div>
        <fieldset class="choice-field">
          <legend>Type de client</legend>
          <label
            ><input v-model="kind" type="radio" value="public" /> Public — application mobile ou
            installée, PKCE obligatoire</label
          >
          <label
            ><input v-model="kind" type="radio" value="confidential" /> Confidentiel — backend
            capable de protéger un secret</label
          >
        </fieldset>
        <div class="field">
          <label for="oauth-create-uris">URI de redirection exactes, une par ligne</label
          ><textarea
            id="oauth-create-uris"
            v-model="redirectUris"
            rows="4"
            required
            spellcheck="false"
            placeholder="https://app.example.com/auth/callback"
          />
        </div>
        <fieldset class="choice-field choice-field--inline">
          <legend>Scopes autorisés</legend>
          <label v-for="scope in OAUTH_SCOPES" :key="scope"
            ><input v-model="selectedScopes" type="checkbox" :value="scope" /> {{ scope }}</label
          >
        </fieldset>
        <MfaCodeField
          id="oauth-create-code"
          v-model="createCode"
          :disabled="createPending"
          label="Code MFA pour créer ce client"
        />
        <p
          v-if="createError"
          id="oauth-create-guidance"
          class="form-message form-message--error"
          role="alert"
        >
          {{ createError }}
        </p>
        <p v-else id="oauth-create-guidance" class="form-guidance">
          Portée : création du client, de ses URI exactes et de ses scopes. L’opération est auditée.
        </p>
        <button type="submit" :disabled="!canCreate" :aria-busy="createPending">
          {{ createPending ? "Création…" : "Créer l’application" }}
        </button>
      </form>
    </section>
  </section>
</template>
