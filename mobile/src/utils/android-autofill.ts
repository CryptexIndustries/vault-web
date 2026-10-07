import {
    credentialMatchesAndroidApp,
    credentialMatchesPageUrl,
    normalizeAndroidAppUri,
} from "@cryptex-industries/vault-core/credential-url";
import { CredentialURLMatchMode } from "@cryptex-industries/vault-core/proto";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { PendingAndroidCredentialRequest } from "@/utils/android-credentials";

export type AutofillTarget = {
    pageUrl: string | null;
    appUri: string | null;
    displayName: string;
    warningType: PendingAndroidCredentialRequest["warningType"];
};

export function defaultAutofillCredentialName(
    request: PendingAndroidCredentialRequest | null,
): string {
    return (
        request?.webDomain?.trim() ||
        request?.applicationLabel?.trim() ||
        request?.packageName?.trim() ||
        "New login"
    );
}

export function isAutofillGetRequest(
    request: PendingAndroidCredentialRequest | null,
): request is PendingAndroidCredentialRequest & {
    kind: "autofill-get" | "accessibility-get";
} {
    return (
        request?.kind === "autofill-get" ||
        request?.kind === "accessibility-get"
    );
}

export function isAutofillSaveRequest(
    request: PendingAndroidCredentialRequest | null,
): request is PendingAndroidCredentialRequest & {
    kind: "autofill-save" | "accessibility-save";
} {
    return (
        request?.kind === "autofill-save" ||
        request?.kind === "accessibility-save"
    );
}

export function autofillEmail(
    credential: Pick<VaultCredential, "CustomFields">,
): string {
    return (
        credential.CustomFields.find(
            (field) => field.Name.trim().toLowerCase() === "email",
        )?.Value.trim() ?? ""
    );
}

export function buildAutofillTarget(
    request: PendingAndroidCredentialRequest,
): AutofillTarget {
    // An address bar without a scheme cannot establish HTTPS. Keep a concrete
    // URL for the picker, but never offer automatic matches for this case.
    const scheme = request.webScheme === "https" ? "https" : "http";
    const domain = request.webDomain?.trim().toLowerCase() || null;
    const pageUrl = domain ? `${scheme}://${domain}` : null;
    const warningType = domain && request.webScheme !== "http" && request.webScheme !== "https"
        ? "unverified-web-scheme"
        : request.warningType;
    const packageName = request.packageName?.trim() || null;
    const appUri = packageName
        ? normalizeAndroidAppUri(`androidapp://${packageName}`)
        : null;
    return {
        pageUrl,
        // A browser or WebView package must never become a substitute for the
        // detected website. Application associations are only native targets.
        appUri: pageUrl == null ? appUri : null,
        displayName:
            domain ||
            request.applicationLabel?.trim() ||
            packageName ||
            "Unknown app",
        warningType,
    };
}

export function matchingAutofillCredentials(
    credentials: readonly VaultCredential[],
    target: AutofillTarget,
): VaultCredential[] {
    if (target.warningType === "unverified-web-scheme") return [];
    return credentials.filter(
        (credential) =>
            !credential.Deleted &&
            !!credential.Password &&
            (target.pageUrl != null
                ? credentialMatchesPageUrl(credential, target.pageUrl, {
                      ignorePort: true,
                  })
                : target.appUri != null &&
                  credentialMatchesAndroidApp(
                      credential,
                      target.appUri.slice("androidapp://".length),
                  )),
    );
}

export function autofillAssociationWarning(
    target: AutofillTarget,
): string | null {
    if (target.warningType === "unverified-web-scheme") {
        return "Browser connection type is unknown. Saved logins will not match automatically. The page may use HTTP; review the form before filling.";
    }
    if (target.warningType === "unverified-field-origin") {
        return "Android could not confirm that the browser page and login field have the same website. Review the page before filling.";
    }
    if (target.warningType === "untrusted-web-context") {
        return `The login field is embedded from a different website than the browser page. Only continue if you trust both sites.`;
    }
    if (target.warningType === "unverified-app") {
        return `Cryptex Vault could not check whether ${target.displayName} is connected to the saved login. Only continue if you trust the installed app.`;
    }
    if (target.pageUrl?.startsWith("http://")) {
        return `This website uses an unencrypted HTTP connection. Only continue if you accept the risk of sending this login.`;
    }
    return null;
}

export function requiresAutofillReview(
    target: AutofillTarget,
    requestKind: PendingAndroidCredentialRequest["kind"] | undefined,
    matched: boolean,
): boolean {
    return !matched || autofillAssociationWarning(target) !== null ||
        (requestKind === "accessibility-get" && target.pageUrl !== null);
}

export type AutofillCredentialRow = {
    credential: VaultCredential;
    isMatch: boolean;
};

/**
 * Builds the single picker list. Matches stay first, both groups sort by name
 * and username, and search always covers the whole eligible set.
 */
export function buildAutofillCredentialRows(
    credentials: readonly VaultCredential[],
    matches: readonly VaultCredential[],
    query: string,
    expanded: boolean,
): AutofillCredentialRow[] {
    const matchIds = new Set(matches.map((credential) => credential.ID));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const includesQuery = (credential: VaultCredential) => {
        if (!normalizedQuery) return true;
        return [
            credential.Name,
            credential.Username,
            credential.URL,
            ...(credential.AdditionalURLs ?? []).map((rule) => rule.URL),
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    };
    const compareCredentials = (left: VaultCredential, right: VaultCredential) => {
        const byName = left.Name.localeCompare(right.Name, undefined, {
            sensitivity: "base",
        });
        return (
            byName ||
            left.Username.localeCompare(right.Username, undefined, {
                sensitivity: "base",
            }) ||
            left.ID.localeCompare(right.ID)
        );
    };
    const matched = matches
        .filter(includesQuery)
        .sort(compareCredentials)
        .map((credential) => ({ credential, isMatch: true }));
    if (!expanded && !normalizedQuery) return matched;
    const unmatched = credentials
        .filter(
            (credential) =>
                !matchIds.has(credential.ID) && includesQuery(credential),
        )
        .sort(compareCredentials)
        .map((credential) => ({ credential, isMatch: false }));
    return [...matched, ...unmatched];
}

export function canAssociateAutofillTarget(target: AutofillTarget): boolean {
    if (target.appUri != null) {
        return (
            target.warningType == null ||
            target.warningType === "unverified-app"
        );
    }
    return (
        target.warningType == null &&
        target.pageUrl != null &&
        target.pageUrl.startsWith("https://")
    );
}

export function appendAutofillAssociation(
    credential: VaultCredential,
    association: string,
): VaultCredential["AdditionalURLs"] {
    const normalized = association.trim().toLocaleLowerCase();
    const existing = credential.AdditionalURLs ?? [];
    if (
        credential.URL.trim().toLocaleLowerCase() === normalized ||
        existing.some(
            (rule) => rule.URL.trim().toLocaleLowerCase() === normalized,
        )
    ) {
        return existing;
    }
    return [
        ...existing,
        {
            URL: association,
            MatchMode: CredentialURLMatchMode.ExactHost,
        },
    ];
}
