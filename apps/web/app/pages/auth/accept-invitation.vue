<script setup lang="ts">
import { authErrorMessage, validPassword } from "~/utils/auth";

useHead({ title: "Accepter l’invitation — NTAuth" });

type InvitationPreview = {
  email: string;
  expiresAt: string;
  organizationName: string;
  role: "admin" | "member" | "owner";
};

const route = useRoute();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const name = ref("");
const password = ref("");
const confirmation = ref("");
const submitting = ref(false);
const accepted = ref(false);
const submitError = ref("");
const { request } = useAuthApi();

const {
  data: invitation,
  error: validationError,
  status: validationStatus,
} = await useAsyncData<InvitationPreview | null>(
  "invitation-preview",
  () =>
    token.value
      ? request<InvitationPreview>("/api/v1/invitations/validate", {
          query: { token: token.value },
        })
      : Promise.resolve(null),
  { watch: [token] },
);

const roleLabel = computed(() => {
  if (invitation.value?.role === "owner") return "Propriétaire";
  if (invitation.value?.role === "admin") return "Administration";
  return "Membre";
});

const passwordError = computed(() => {
  if (!password.value) return "";
  if (!validPassword(password.value)) return "Utilisez entre 12 et 128 caractères.";
  if (confirmation.value && confirmation.value !== password.value)
    return "Les deux mots de passe ne correspondent pas.";
  return "";
});

const invalidInvitationMessage = computed(() =>
  validationError.value
    ? authErrorMessage(
        validationError.value,
        "L’invitation ne peut pas être vérifiée. Réessayez dans quelques instants.",
      )
    : "",
);

async function acceptInvitation() {
  if (
    submitting.value ||
    !invitation.value ||
    !name.value.trim() ||
    !password.value ||
    !confirmation.value ||
    passwordError.value ||
    password.value !== confirmation.value
  )
    return;

  submitting.value = true;
  submitError.value = "";
  try {
    await request("/api/v1/invitations/accept", {
      body: { name: name.value.trim(), password: password.value, token: token.value },
      method: "POST",
    });
    accepted.value = true;
    password.value = "";
    confirmation.value = "";
  } catch (error) {
    submitError.value = authErrorMessage(
      error,
      "L’invitation n’a pas pu être acceptée. Vérifiez les champs puis réessayez.",
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-register">
    <aside class="auth-register__context" aria-labelledby="invitation-context-title">
      <div>
        <h1 id="invitation-context-title">Rejoindre votre organisation NeoTamia</h1>
        <p>
          L’invitation fixe l’organisation et le rôle. Ces informations viennent uniquement du
          serveur.
        </p>
      </div>
      <dl v-if="invitation" class="auth-facts" aria-label="Portée de l’invitation">
        <div>
          <dt>Organisation</dt>
          <dd>{{ invitation.organizationName }}</dd>
        </div>
        <div>
          <dt>Rôle</dt>
          <dd>{{ roleLabel }}</dd>
        </div>
        <div>
          <dt>Compte</dt>
          <dd>{{ invitation.email }}</dd>
        </div>
      </dl>
      <p v-else class="auth-register__assurance">
        Un lien est valable 72 heures et ne peut créer qu’une seule adhésion.
      </p>
    </aside>

    <section class="auth-workspace" aria-labelledby="invitation-title">
      <header>
        <h2 id="invitation-title">Accepter l’invitation</h2>
        <p>Définissez votre identité et un mot de passe propre à NTAuth.</p>
      </header>

      <div v-if="!token" class="auth-result auth-result--error" role="alert">
        <h3>Lien incomplet</h3>
        <p>Ce lien ne contient aucun jeton d’invitation.</p>
        <NuxtLink class="button" to="/auth/sign-in">Revenir à la connexion</NuxtLink>
      </div>
      <div
        v-else-if="validationStatus === 'pending'"
        class="auth-result"
        role="status"
        aria-live="polite"
      >
        <h3>Vérification en cours…</h3>
        <p>NTAuth vérifie la validité et la portée de l’invitation.</p>
      </div>
      <div v-else-if="validationError" class="auth-result auth-result--error" role="alert">
        <h3>Invitation indisponible</h3>
        <p>{{ invalidInvitationMessage }}</p>
        <NuxtLink class="button" to="/auth/sign-in">Revenir à la connexion</NuxtLink>
      </div>
      <div v-else-if="accepted" class="auth-result" role="status">
        <h3>Organisation rejointe</h3>
        <p>
          Votre compte est prêt et l’adhésion a été enregistrée. Vous pouvez maintenant ouvrir une
          session.
        </p>
        <NuxtLink class="button" to="/auth/sign-in">Se connecter</NuxtLink>
      </div>
      <form
        v-else-if="invitation"
        :aria-describedby="submitError ? 'invitation-error' : 'invitation-guidance'"
        @submit.prevent="acceptInvitation"
      >
        <div class="field">
          <label for="invited-name">Nom affiché</label>
          <input
            id="invited-name"
            v-model="name"
            name="name"
            type="text"
            autocomplete="name"
            maxlength="100"
            required
            :disabled="submitting"
          />
        </div>
        <div class="field">
          <label for="invited-password">Mot de passe</label>
          <input
            id="invited-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
            :aria-invalid="Boolean(passwordError)"
            :disabled="submitting"
          />
        </div>
        <div class="field">
          <label for="invited-password-confirmation">Confirmer le mot de passe</label>
          <input
            id="invited-password-confirmation"
            v-model="confirmation"
            name="password-confirmation"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
            :aria-invalid="Boolean(confirmation && confirmation !== password)"
            :disabled="submitting"
          />
        </div>
        <p
          v-if="submitError"
          id="invitation-error"
          class="form-message form-message--error"
          role="alert"
        >
          {{ submitError }}
        </p>
        <p
          v-else
          id="invitation-guidance"
          class="form-guidance"
          :class="{ 'form-guidance--error': passwordError }"
        >
          {{ passwordError || "Utilisez entre 12 et 128 caractères." }}
        </p>
        <button
          type="submit"
          :disabled="
            submitting ||
            !name.trim() ||
            !password ||
            !confirmation ||
            Boolean(passwordError) ||
            password !== confirmation
          "
          :aria-busy="submitting"
        >
          {{ submitting ? "Acceptation en cours…" : "Rejoindre l’organisation" }}
        </button>
      </form>
    </section>
  </div>
</template>
