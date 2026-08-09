<script setup lang="ts">
const model = defineModel<string>({ required: true });
defineProps<{
  describedBy?: string;
  disabled?: boolean;
  id: string;
  label?: string;
}>();
const { isElevated } = useMfaChallenge();

const normalizedCode = computed({
  get: () => model.value,
  set: (value: string) => {
    model.value = value.replace(/\D/g, "").slice(0, 6);
  },
});
</script>

<template>
  <div v-if="isElevated" class="mfa-elevation-status" role="status">
    <strong>Session MFA active</strong>
    <span>Aucun nouveau code requis pendant cette fenêtre.</span>
  </div>
  <div v-else class="field">
    <label :for="id">{{ label ?? "Code à 6 chiffres" }}</label>
    <input
      :id="id"
      v-model="normalizedCode"
      name="totp-code"
      type="text"
      autocomplete="one-time-code"
      inputmode="numeric"
      pattern="[0-9]{6}"
      maxlength="6"
      required
      :aria-describedby="describedBy"
      :disabled="disabled"
    />
  </div>
</template>
