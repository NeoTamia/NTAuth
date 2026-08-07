import { parseWorkerEnvironment } from "@neotamia/config";

const environment = parseWorkerEnvironment();

console.log(`NTAuth worker ready; polling every ${environment.EMAIL_OUTBOX_POLL_INTERVAL_MS}ms`);
