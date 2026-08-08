<script setup lang="ts">
import QRCode from "qrcode";

import { authErrorMessage } from "~/utils/auth";
import { totpSecretFromUri, validTotpCode } from "~/utils/mfa";

definePageMeta({ layout: "admin" });
useHead({ title: "Sécurité MFA — NTAuth" });

type MfaStatus = { status: "not_enrolled" | "pending" | "verified" };

const currentPassword = ref("");
const code = ref("");
const totpURI = ref("");
const qrDataURL = ref("");
const qrError = ref("");
const actionError = ref("");
const enrollmentComplete = ref(false);
const starting = ref(false);
const verifying = ref(false);
const { request } = useAuthApi();

const {
  data: mfaStatus,
  error: statusError,
  refresh: refreshStatus,
  status: loadingStatus,
} = await useAsyncData<MfaStatus>("mfa-status", () => request("/api/v1/mfa/status"));

const secret = computed(() => totpSecretFromUri(totpURI.value));
const canStart = computed(() => currentPassword.value.length > 0 && !starting.value);
const canVerify = computed(() => validTotpCode(code.value) && !verifying.value);

function safeMfaError(error: unknown, fallback: string) {
  return authErrorMessage(error, fallback);
}

async function startEnrollment() {
  if (!canStart.value) return;
  starting.value = true;
  actionError.value = "";
  qrError.value = "";
  enrollmentComplete.value = false;
  totpURI.value = "";
  qrDataURL.value = "";
  try {
    const enrollment = await request<{ totpURI: string }>("/api/v1/mfa/enroll", {
      body: { password: currentPassword.value },
      method: "POST",
    });
    totpURI.value = enrollment.totpURI;
    if (!secret.value) throw new Error("invalid TOTP enrollment URI");
    try {
      qrDataURL.value = await QRCode.toDataURL(enrollment.totpURI, {
        color: { dark: "#14201b", light: "#f5f7f3" },
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      });
    } catch {
      qrError.value = "Le QR code n’a pas pu être généré. Utilisez la clé manuelle ci-dessous.";
    }
    await refreshStatus();
  } catch (error) {
    totpURI.value = "";
    actionError.value = safeMfaError(
      error,
      "L’enrôlement ne peut pas démarrer. Vérifiez votre mot de passe puis réessayez.",
    );
  } finally {
    currentPassword.value = "";
    starting.value = false;
  }
}

async function verifyEnrollment() {
  if (!canVerify.value || !totpURI.value) return;
  verifying.value = true;
  actionError.value = "";
  try {
    await request("/api/v1/mfa/verify", {
      body: { code: code.value },
      method: "POST",
    });
    enrollmentComplete.value = true;
    code.value = "";
    totpURI.value = "";
    qrDataURL.value = "";
    qrError.value = "";
    await refreshStatus();
  } catch (error) {
    actionError.value = safeMfaError(
      error,
      "Ce code est invalide, expiré ou déjà utilisé. Attendez le prochain code puis réessayez.",
    );
  } finally {
    verifying.value = false;
  }
}
</script>

<template>
  <section class="admin-security" aria-labelledby="mfa-title">
    <header>
      <h1 id="mfa-title">Authentification à deux facteurs</h1>
      <p>
        Protégez les actions d’administration plateforme avec un code temporaire généré sur votre
        appareil.
      </p>
    </header>

    <dl class="security-scope" aria-label="Portée de la protection">
      <div>
        <dt>Portée</dt>
        <dd>Compte actuel</dd>
      </div>
      <div>
        <dt>Méthode</dt>
        <dd>TOTP, 6 chiffres, 30 secondes</dd>
      </div>
      <div>
        <dt>Usage</dt>
        <dd>Chaque mutation plateforme sensible</dd>
      </div>
    </dl>

    <div v-if="loadingStatus === 'pending'" class="auth-result" role="status">
      <h2>Vérification du statut…</h2>
      <p>NTAuth vérifie la protection du compte.</p>
    </div>
    <div v-else-if="statusError" class="auth-result auth-result--error" role="alert">
      <h2>Accès indisponible</h2>
      <p>
        Cette page est réservée aux administrateurs plateforme ou le statut ne peut pas être chargé.
      </p>
    </div>
    <div v-else-if="mfaStatus?.status === 'verified' && !totpURI" class="mfa-status" role="status">
      <div>
        <h2>Protection active</h2>
        <p>
          L’enrôlement est confirmé. Les actions sensibles demanderont un nouveau code à usage
          unique.
        </p>
      </div>
      <strong>{{ enrollmentComplete ? "Configuration terminée" : "TOTP vérifié" }}</strong>
    </div>
    <div v-else-if="totpURI" class="enrollment-grid">
      <section aria-labelledby="enrollment-device-title">
        <h2 id="enrollment-device-title">1. Ajouter NTAuth à l’application</h2>
        <p>Scannez le QR code ou saisissez la clé. Ils disparaîtront après confirmation.</p>
        <div class="qr-panel">
          <img v-if="qrDataURL" :src="qrDataURL" alt="QR code d’enrôlement TOTP NTAuth" />
          <p v-if="qrError" class="form-message form-message--error" role="alert">
            {{ qrError }}
          </p>
          <div>
            <span>Clé manuelle</span>
            <code class="secret-value">{{ secret }}</code>
          </div>
        </div>
      </section>
      <section aria-labelledby="enrollment-verify-title">
        <h2 id="enrollment-verify-title">2. Confirmer l’enrôlement</h2>
        <p>Saisissez le code courant pour prouver que l’application est configurée.</p>
        <form
          :aria-describedby="actionError ? 'mfa-action-error' : 'mfa-code-guidance'"
          @submit.prevent="verifyEnrollment"
        >
          <MfaCodeField id="mfa-enrollment-code" v-model="code" :disabled="verifying" />
          <p
            v-if="actionError"
            id="mfa-action-error"
            class="form-message form-message--error"
            role="alert"
          >
            {{ actionError }}
          </p>
          <p v-else id="mfa-code-guidance" class="form-guidance">
            Un code accepté ne peut pas être rejoué.
          </p>
          <button type="submit" :disabled="!canVerify" :aria-busy="verifying">
            {{ verifying ? "Confirmation…" : "Confirmer et activer" }}
          </button>
        </form>
      </section>
    </div>
    <section v-else class="enrollment-start" aria-labelledby="enrollment-start-title">
      <h2 id="enrollment-start-title">
        {{ mfaStatus?.status === "pending" ? "Reprendre la configuration" : "Activer TOTP" }}
      </h2>
      <p v-if="mfaStatus?.status === 'pending'" class="notice">
        Une configuration précédente n’a pas été confirmée. Saisissez à nouveau votre mot de passe
        pour générer une nouvelle clé ; l’ancienne deviendra inutilisable.
      </p>
      <p v-else>
        Confirmez d’abord votre mot de passe. Le secret TOTP ne sera affiché qu’à l’étape suivante.
      </p>
      <form
        :aria-describedby="actionError ? 'mfa-start-error' : 'mfa-password-guidance'"
        @submit.prevent="startEnrollment"
      >
        <div class="field">
          <label for="mfa-current-password">Mot de passe actuel</label>
          <input
            id="mfa-current-password"
            v-model="currentPassword"
            name="current-password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="starting"
          />
        </div>
        <p
          v-if="actionError"
          id="mfa-start-error"
          class="form-message form-message--error"
          role="alert"
        >
          {{ actionError }}
        </p>
        <p v-else id="mfa-password-guidance" class="form-guidance">
          Cette confirmation démarre un enrôlement audité pour le compte actuel.
        </p>
        <button type="submit" :disabled="!canStart" :aria-busy="starting">
          {{ starting ? "Préparation…" : "Générer le QR code" }}
        </button>
      </form>
    </section>
  </section>
</template>
