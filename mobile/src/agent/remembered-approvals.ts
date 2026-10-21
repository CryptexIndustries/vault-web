import { RememberedApprovals } from "@cryptex-industries/vault-core/agent/remember";

/**
 * The app's remembered approvals, in memory only. The runtime adds and
 * matches them, and clears them when the vault starts locking, so they end
 * with the vault session.
 */
export const rememberedApprovals = new RememberedApprovals();
