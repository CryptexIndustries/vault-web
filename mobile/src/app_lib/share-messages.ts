import { t } from "@lingui/core/macro";
import {
    ShareServerError,
    type ShareStatus,
} from "@cryptex-industries/vault-core/vault-utils/share-client";
import type { ShareListSort } from "@cryptex-industries/vault-core/vault-utils/share-list";
import { describeShareError } from "@cryptex-industries/vault-core/vault-utils/share-messages";
import { ShareSetupError } from "@cryptex-industries/vault-core/vault-utils/share-service";

export function shareErrorText(error: unknown): string {
    if (error instanceof ShareSetupError) {
        switch (error.code) {
            case "sign_in_required":
                return t`Sign in to Online Services to create share links.`;
            case "subscription_required":
                return t`Share links are part of Online Services. Upgrade, or point Cryptex Vault at a self-hosted share server.`;
            case "token_required":
                return t`This share server needs a creation token. Ask its operator for one.`;
            case "too_large":
                return t`That's too much for one share link. Leave out some fields.`;
            case "expiry_too_long":
                return t`This share server doesn't keep links that long. Choose a shorter expiry.`;
            case "not_online_services_server":
                return t`This share server doesn't accept Online Services sign-ins. Check the share server address in settings.`;
            case "vault_changed":
                return t`The vault was locked or switched while the link was being created, so the link was cancelled. Create it again.`;
            case "share_id_conflict":
                return t`The share server answered with a link that's already in your list, so the new link was cancelled.`;
            default:
                return describeShareError(error);
        }
    }
    if (error instanceof ShareServerError) {
        switch (error.code) {
            case "unauthorized":
                return t`The share server didn't accept the request. Check the creation token, or sign in again.`;
            case "forbidden":
                return t`Share links are part of Online Services. Upgrade, or point Cryptex Vault at a self-hosted share server.`;
            case "limit_reached":
                return t`You have the maximum number of open share links. Revoke one or wait for one to expire.`;
            case "rate_limited":
                return t`Too many requests. Try again in a minute.`;
            case "too_large":
                return t`That's too much for one share link. Leave out some fields.`;
            case "gone":
                return t`That link no longer exists.`;
            case "unavailable":
                return t`Can't reach the share server. Check your connection and try again.`;
            case "wrong_passphrase":
            case "bad_request":
                return t`The share server rejected the request.`;
            default:
                return describeShareError(error);
        }
    }
    return t`Something went wrong while creating the link.`;
}

export function shareStatusLabel(status: ShareStatus): string {
    switch (status) {
        case "active":
            return t({ message: "Active", context: "share link status" });
        case "viewed":
            return t({ message: "Opened", context: "share link status" });
        case "expired":
        case "unknown":
            return t({ message: "Expired", context: "share link status" });
        case "revoked":
            return t({ message: "Revoked", context: "share link status" });
        case "burned":
            return t({ message: "Destroyed", context: "share link status" });
    }
}

export function shareSortLabel(sort: ShareListSort): string {
    switch (sort) {
        case "newest":
            return t`Newest first`;
        case "oldest":
            return t`Oldest first`;
        case "expiring":
            return t`Expiring soonest`;
        case "name":
            return t({
                message: "Name A–Z",
                comment: "Sort option: alphabetical by name",
            });
    }
}
