<script setup lang="ts">
defineProps<{ value: string | number | null | undefined }>();
</script>

<template>
  <span v-if="value === null || value === undefined || value === ''" class="unknown">UNKNOWN</span>
  <span v-else>{{ value }}</span>
</template>
