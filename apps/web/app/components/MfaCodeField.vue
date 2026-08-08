<script setup lang="ts">
const model = defineModel<string>({ required: true });
defineProps<{
  describedBy?: string;
  disabled?: boolean;
  id: string;
  label?: string;
}>();

function keepDigits(event: Event) {
  const target = event.target as HTMLInputElement;
  model.value = target.value.replace(/\D/g, "").slice(0, 6);
}
</script>

<template>
  <div class="field">
    <label :for="id">{{ label ?? "Code à 6 chiffres" }}</label>
    <input
      :id="id"
      :value="model"
      name="totp-code"
      type="text"
      autocomplete="one-time-code"
      inputmode="numeric"
      pattern="[0-9]{6}"
      maxlength="6"
      required
      :aria-describedby="describedBy"
      :disabled="disabled"
      @input="keepDigits"
    />
  </div>
</template>
