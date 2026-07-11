/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Bindings = {
  DB: D1Database;
  // Spot photo storage. Workers KV instead of R2: same free Workers plan, no separate
  // dashboard enablement/payment method required (R2 requires opting in via the dashboard).
  IMAGES: KVNamespace;
  // CMS admin password. Local dev: .dev.vars (gitignored). Production: `wrangler secret put ADMIN_PASSWORD`.
  // If unset, all admin endpoints fail closed with 503 instead of falling back to a default.
  ADMIN_PASSWORD?: string;
};
