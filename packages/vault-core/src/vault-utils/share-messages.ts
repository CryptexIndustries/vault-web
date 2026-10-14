/** User-facing text for share link errors, shared by web, extension and mobile. */

import { ShareServerError } from "./share-client";
import { ShareSetupError } from "./share-service";

export function describeShareError(error: unknown): string {
    if (error instanceof ShareSetupError) {
        switch (error.code) {
            case "sign_in_required":
                return "Sign in to Online Services to create share links.";
            case "subscription_required":
                return "Share links are part of Online Services. Upgrade, or point Cryptex Vault at a self-hosted share server.";
            case "token_required":
                return "This share server needs a creation token. Ask its operator for one.";
            case "too_large":
                return "That's too much for one share link. Leave out some fields.";
            case "expiry_too_long":
                return "This share server doesn't keep links that long. Choose a shorter expiry.";
            case "not_online_services_server":
                return "This share server doesn't accept Online Services sign-ins. Check the share server address in settings.";
            case "vault_changed":
                return "The vault was locked or switched while the link was being created, so the link was cancelled. Create it again.";
            case "share_id_conflict":
                return "The share server answered with a link that's already in your list, so the new link was cancelled.";
        }
    }
    if (error instanceof ShareServerError) {
        switch (error.code) {
            case "unauthorized":
                return "The share server didn't accept the request. Check the creation token, or sign in again.";
            case "forbidden":
                return "Share links are part of Online Services. Upgrade, or point Cryptex Vault at a self-hosted share server.";
            case "limit_reached":
                return "You have the maximum number of open share links. Revoke one or wait for one to expire.";
            case "rate_limited":
                return "Too many requests. Try again in a minute.";
            case "too_large":
                return "That's too much for one share link. Leave out some fields.";
            case "gone":
                return "That link no longer exists.";
            case "unavailable":
                return "Can't reach the share server. Check your connection and try again.";
            default:
                return "The share server rejected the request.";
        }
    }
    return "Something went wrong while creating the link.";
}
