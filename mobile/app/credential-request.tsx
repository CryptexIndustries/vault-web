import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useAtomValue } from "jotai";
import { KeyRound, Plus } from "lucide-react-native";
import { ulid } from "ulidx";
import { credentialMatchesPageUrl } from "@cryptex-industries/vault-core/credential-url";
import { CredentialURLMatchMode, CustomFieldType, ItemType } from "@cryptex-industries/vault-core/proto";
import {
    createCredential,
    calculateTOTP,
    updateCredentialFromForm,
    Vault,
    type CredentialFormSchemaType,
    type VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

import { assertAndroidPasskey, createAndroidPasskey } from "@/utils/android-passkeys";
import {
    appendAutofillAssociation,
    autofillAssociationWarning,
    autofillEmail,
    buildAutofillCredentialRows,
    buildAutofillTarget,
    canAssociateAutofillTarget,
    defaultAutofillCredentialName,
    isAutofillGetRequest,
    isAutofillSaveRequest,
    matchingAutofillCredentials,
    requiresAutofillReview,
    type AutofillTarget,
} from "@/utils/android-autofill";
import { androidCredentials, type PendingAndroidCredentialRequest } from "@/utils/android-credentials";
import { buildAndroidProviderCredentials } from "@/utils/android-provider-credentials";
import { isVaultUnlockedAtom, vaultCredentialsAtom, vaultStore } from "@/utils/atoms";
import { getCachedAutoLockMinutes } from "@/utils/auto-lock-settings";
import { loadAutoCopyTotp } from "@/utils/autofill-settings";
import { copySecretToClipboard } from "@/utils/clipboard";
import { passkeyLog } from "@/utils/logging";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import type { VaultMutationError } from "@/utils/vault-mutations";
import { isAutoLockDue, useAutoLock } from "@/hooks/use-auto-lock";
import { CredentialForm } from "@/components/vault/credential-form";
import { UnlockedConfirmationProvider } from "@/components/unlocked/confirmation-sheet";
import {
    AssociationConsentScreen,
    AutofillPicker,
    AutofillRequestShell,
    FillDecisionScreen,
    RequestDestination,
    SaveFailureSheet,
} from "@/components/autofill/request-ui";
import { UnlockedButton, UnlockedText } from "@/components/unlocked/unlocked-ui";
import { InlineNotice } from "@/components/inline-notice";
import { colors } from "@/theme";

const REQUEST_EXPIRED = "This credential request expired. Return to the app or browser and try again.";
type RequestView = "picker" | "decision" | "associate" | "editor" | "save-choice";
type EditorPurpose = "add" | "captured";
let lastAutoCompletedPasskeyRequestId: string | null = null;

function decodeClientDataHash(value: string) {
    try {
        const decoded = Uint8Array.from(globalThis.atob(value), (character) => character.charCodeAt(0));
        if (decoded.length !== 32) throw new Error();
        return decoded;
    } catch {
        throw new Error("PASSKEY_CLIENT_DATA_HASH_INVALID");
    }
}

function passkeyFailureCode(stage: string, error: unknown) {
    const message = error instanceof Error ? error.message : error;
    return typeof message === "string" && /^[A-Z][A-Z0-9_]{2,80}$/u.test(message)
        ? message
        : `PASSKEY_${stage.toUpperCase()}_FAILED`;
}

async function verifyPasskeyUser(operation: "Create" | "Use", relyingParty: string) {
    const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `${operation} passkey`,
        promptSubtitle: relyingParty,
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
        requireConfirmation: true,
        biometricsSecurityLevel: "strong",
    });
    if (result.success) return;
    if (["user_cancel", "app_cancel", "system_cancel"].includes(result.error)) {
        throw new Error("PASSKEY_USER_VERIFICATION_CANCELLED");
    }
    throw new Error("PASSKEY_USER_VERIFICATION_FAILED");
}

export default function CredentialRequestScreen() {
    const isFocused = useIsFocused();
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const credentials = useAtomValue(vaultCredentialsAtom);
    const { onInteraction } = useAutoLock(isFocused);
    const [request, setRequest] = useState<PendingAndroidCredentialRequest | null>(null);
    const [requestLoaded, setRequestLoaded] = useState(false);
    const [providerWebOrigin, setProviderWebOrigin] = useState<string | null | undefined>();
    const [view, setView] = useState<RequestView>("picker");
    const [editorPurpose, setEditorPurpose] = useState<EditorPurpose>("add");
    const [editorCredentialId, setEditorCredentialId] = useState<string | null>();
    const [selected, setSelected] = useState<VaultCredential | null>(null);
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [requestError, setRequestError] = useState("");
    const [associationError, setAssociationError] = useState("");
    const [saveFailureOpen, setSaveFailureOpen] = useState(false);
    const [saveFailureCode, setSaveFailureCode] = useState<VaultMutationError>("VAULT_MUTATION_FAILED");
    const retrySaveRef = useRef<(() => void) | null>(null);
    const requestIdRef = useRef<string | null>(null);
    const requestSessionGenerationRef = useRef<number | null>(null);
    const requestHadUnlockedSessionRef = useRef(false);

    const loadPendingRequest = useCallback(() => {
        const pending = androidCredentials.getPendingRequest();
        if (pending?.id === requestIdRef.current) return;
        requestIdRef.current = pending?.id ?? null;
        requestSessionGenerationRef.current = pending ? getVaultSessionGeneration() : null;
        requestHadUnlockedSessionRef.current = pending ? vaultStore.get(isVaultUnlockedAtom) : false;
        setRequest(pending);
        setRequestLoaded(true);
        setProviderWebOrigin(undefined);
        setView(
            pending && (isAutofillSaveRequest(pending) || pending.kind === "provider-password-create")
                ? "editor"
                : "picker",
        );
        setEditorPurpose(pending && (isAutofillSaveRequest(pending) || pending.kind === "provider-password-create") ? "captured" : "add");
        setEditorCredentialId(undefined);
        setSelected(null);
        setQuery("");
        setExpanded(false);
        setBusy(false);
        setRequestError("");
        setAssociationError("");
        setSaveFailureOpen(false);
        retrySaveRef.current = null;
    }, []);

    useFocusEffect(loadPendingRequest);
    useEffect(() => {
        const subscription = androidCredentials.addCredentialRequestListener(loadPendingRequest);
        return () => subscription.remove();
    }, [loadPendingRequest]);

    useEffect(() => {
        // Resuming the app does not refocus an already focused request screen.
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") loadPendingRequest();
        });
        return () => subscription.remove();
    }, [loadPendingRequest]);

    useEffect(() => {
        if (!request) return;
        if (unlocked) {
            if (!requestHadUnlockedSessionRef.current) {
                requestHadUnlockedSessionRef.current = true;
                requestSessionGenerationRef.current = getVaultSessionGeneration();
            }
            return;
        }
        // A background auto-lock may finish just after Android opens this screen.
        // Keep the short-lived request, but require a new unlocked session before fill.
        requestSessionGenerationRef.current = null;
        requestHadUnlockedSessionRef.current = false;
    }, [request, unlocked]);

    const requestGuard = useCallback((): string | null => {
        if (
            !request ||
            isAutoLockDue() ||
            !vaultStore.get(isVaultUnlockedAtom) ||
            requestSessionGenerationRef.current !== getVaultSessionGeneration()
        ) return REQUEST_EXPIRED;
        const current = androidCredentials.getPendingRequest();
        return current?.id === request.id && current.kind === request.kind ? null : REQUEST_EXPIRED;
    }, [request]);
    const returnToVault = () => router.replace("/(app)/(tabs)/vault");
    const cancelRequest = () => {
        androidCredentials.dismissRequest(request?.id);
        returnToVault();
    };

    useEffect(() => {
        if (requestLoaded && !request) returnToVault();
    }, [request, requestLoaded]);

    useEffect(() => {
        if (request?.kind !== "provider-unlock" || !unlocked) return;
        if (requestGuard()) {
            setRequestError(REQUEST_EXPIRED);
            return;
        }
        androidCredentials.setProviderCredentials(
            buildAndroidProviderCredentials(credentials),
            getCachedAutoLockMinutes(),
        );
        if (!androidCredentials.completeProviderUnlock(request.id)) setRequestError(REQUEST_EXPIRED);
        else returnToVault();
    }, [credentials, request, requestGuard, unlocked]);

    useEffect(() => {
        if (request?.kind !== "provider-password-get") return;
        const expectedId = request.id;
        void androidCredentials.resolvePendingWebOrigin().then((origin) => {
            if (androidCredentials.getPendingRequest()?.id === expectedId) setProviderWebOrigin(origin);
        });
    }, [request]);

    const providerTargetUrl = useMemo(() => {
        if (!providerWebOrigin) return null;
        try {
            const parsed = new URL(providerWebOrigin);
            return ["https:", "http:"].includes(parsed.protocol) ? parsed.origin : null;
        } catch {
            return null;
        }
    }, [providerWebOrigin]);

    const target = useMemo<AutofillTarget | null>(() => {
        if (!request) return null;
        if (isAutofillGetRequest(request) || isAutofillSaveRequest(request)) return buildAutofillTarget(request);
        if (!["provider-password-get", "provider-password-create"].includes(request.kind)) return null;
        if (providerTargetUrl) {
            const parsed = new URL(providerTargetUrl);
            return {
                pageUrl: parsed.origin,
                appUri: null,
                displayName: parsed.hostname,
                warningType: parsed.protocol === "https:" ? null : "untrusted-web-context",
            };
        }
        return buildAutofillTarget({ ...request, warningType: "unverified-app" });
    }, [providerTargetUrl, request]);

    const accessibilityOriginWarning = request?.kind === "accessibility-get" && target?.pageUrl
        ? "An embedded or hidden frame may receive this login even when the address bar shows another site. Only fill if you trust this page and its embedded content."
        : null;

    const eligibleCredentials = useMemo(
        () => credentials.filter((credential) => !credential.Deleted && !!credential.Password),
        [credentials],
    );
    const matches = useMemo(() => {
        if (!target) return [];
        const candidates = request?.credentialId
            ? eligibleCredentials.filter((credential) => credential.ID === request.credentialId)
            : eligibleCredentials;
        if (target.pageUrl && request?.kind === "provider-password-get") {
            return candidates.filter((credential) =>
                credentialMatchesPageUrl(credential, target.pageUrl!, { ignorePort: true }),
            );
        }
        return matchingAutofillCredentials(candidates, target);
    }, [eligibleCredentials, request?.credentialId, request?.kind, target]);
    const rows = useMemo(
        () => buildAutofillCredentialRows(eligibleCredentials, matches, query, expanded),
        [eligibleCredentials, expanded, matches, query],
    );

    const completeLogin = useCallback(
        async (credential: VaultCredential) => {
            if (!request || requestGuard()) {
                setRequestError(REQUEST_EXPIRED);
                setView("picker");
                return false;
            }
            onInteraction();
            let totp = "";
            try {
                if (credential.TOTP?.Secret) totp = calculateTOTP(credential.TOTP).code;
            } catch {
                totp = "";
            }
            const copyTotp = !!totp && (await loadAutoCopyTotp());
            if (requestGuard()) {
                setRequestError(REQUEST_EXPIRED);
                setView("picker");
                return false;
            }
            const completed = request.kind === "provider-password-get"
                ? androidCredentials.completeProviderPassword(request.id, credential.Username, credential.Password)
                : request.kind === "accessibility-get"
                  ? androidCredentials.completeAccessibilityAutofill(
                        request.id,
                        credential.Username,
                        autofillEmail(credential),
                        credential.Password,
                        totp,
                    )
                  : androidCredentials.completeAutofill(
                        request.id,
                        credential.Username,
                        autofillEmail(credential),
                        credential.Password,
                    );
            if (completed && copyTotp) await copySecretToClipboard(totp);
            if (!completed) {
                setRequestError(REQUEST_EXPIRED);
                setView("picker");
            }
            else returnToVault();
            return completed;
        },
        [onInteraction, request, requestGuard],
    );

    const beginFill = (credential: VaultCredential) => {
        setSelected(credential);
        setAssociationError("");
        const matched = matches.some((item) => item.ID === credential.ID);
        if (!target || !requiresAutofillReview(target, request?.kind, matched)) {
            void completeLogin(credential);
        } else {
            setView("decision");
        }
    };

    const persistAssociationAndFill = async () => {
        const association = target?.pageUrl ?? target?.appUri;
        if (!selected || !target || !association || !canAssociateAutofillTarget(target)) return;
        const gate = requestGuard();
        if (gate) {
            setAssociationError(gate);
            return;
        }
        setBusy(true);
        setAssociationError("");
        let serializedGate: string | null = null;
        const result = await persistVaultMutation("credential.upsert", async (current) => {
            serializedGate = requestGuard();
            if (serializedGate) throw new Error("REQUEST_INVALID");
            const currentCredential = current.Credentials.find(
                (credential) => credential.ID === selected.ID && !credential.Deleted,
            );
            if (!currentCredential) throw new Error("CREDENTIAL_MISSING");
            const saved = await updateCredentialFromForm(currentCredential, {
                ...currentCredential,
                AdditionalURLs: appendAutofillAssociation(currentCredential, association),
            });
            const next = Object.assign(new Vault(), current);
            next.Credentials = current.Credentials.map((credential) =>
                credential.ID === saved.ID ? saved : credential,
            );
            return { vault: next, result: saved };
        });
        setBusy(false);
        if (result.isErr()) {
            setAssociationError(
                serializedGate ?? "The association could not be saved. The login was not filled. Go back to fill once.",
            );
            return;
        }
        if (requestGuard()) {
            setAssociationError("The association was saved, but the request expired before Cryptex Vault could fill the login.");
            return;
        }
        await completeLogin(result.value);
    };

    const passkeyRequest = useMemo(() => {
        try {
            return request?.requestJson
                ? (JSON.parse(request.requestJson) as {
                      rpId?: string;
                      rp?: { id?: string; name?: string };
                      user?: { name?: string; displayName?: string };
                      allowCredentials?: { type?: string; id?: string }[];
                      excludeCredentials?: { type?: string; id?: string }[];
                  })
                : null;
        } catch {
            return null;
        }
    }, [request?.requestJson]);
    const passkeyMatches = useMemo(() => {
        const allowed = new Set(
            passkeyRequest?.allowCredentials
                ?.filter((descriptor) => descriptor.type === "public-key")
                .map((descriptor) => descriptor.id)
                .filter((id): id is string => !!id) ?? [],
        );
        return credentials.filter(
            (credential) =>
                !credential.Deleted &&
                credential.Passkey &&
                (!request?.credentialId || credential.Passkey.CredentialID === request.credentialId) &&
                (!passkeyRequest?.rpId || credential.Passkey.RPID.toLowerCase() === passkeyRequest.rpId.toLowerCase()) &&
                (!allowed.size || allowed.has(credential.Passkey.CredentialID)),
        );
    }, [credentials, passkeyRequest, request?.credentialId]);

    const completePasskeyGet = useCallback(
        async (credentialId: string) => {
            if (!request?.requestJson || !passkeyRequest?.rpId || requestGuard()) {
                setRequestError(request?.requestJson ? REQUEST_EXPIRED : "This passkey request is malformed.");
                return;
            }
            const credential = credentials.find(
                (item) => !item.Deleted && item.Passkey?.CredentialID === credentialId,
            );
            if (!credential?.Passkey) return;
            setBusy(true);
            let stage = "resolve_origin";
            try {
                const resolution = await androidCredentials.resolvePendingPasskeyOrigin(passkeyRequest.rpId);
                if (!resolution.origin) throw new Error(resolution.errorCode ?? "PASSKEY_ORIGIN_REJECTED");
                stage = "user_verification";
                await verifyPasskeyUser("Use", passkeyRequest.rpId);
                if (requestGuard()) throw new Error("PASSKEY_REQUEST_EXPIRED");
                onInteraction();
                stage = "generate_assertion";
                const response = await assertAndroidPasskey(
                    request.requestJson,
                    resolution.origin,
                    credential.Passkey,
                    request.clientDataHash && !resolution.origin.startsWith("android:")
                        ? decodeClientDataHash(request.clientDataHash)
                        : undefined,
                );
                stage = "complete_android_request";
                if (requestGuard()) throw new Error("PASSKEY_REQUEST_EXPIRED");
                if (!androidCredentials.completeProviderPasskeyGet(request.id, response)) {
                    throw new Error("PASSKEY_REQUEST_EXPIRED");
                }
                passkeyLog.info("Passkey assertion completed");
                returnToVault();
            } catch (error) {
                passkeyLog.error("Passkey assertion failed", {
                    stage,
                    code: passkeyFailureCode(stage, error),
                    errorType: error instanceof Error ? error.name : typeof error,
                });
                if (error instanceof Error && error.message === "PASSKEY_USER_VERIFICATION_CANCELLED") {
                    androidCredentials.dismissRequest(request.id);
                    returnToVault();
                    return;
                }
                setRequestError("Could not complete this passkey request.");
                setBusy(false);
            }
        },
        [credentials, onInteraction, passkeyRequest?.rpId, request, requestGuard],
    );

    useEffect(() => {
        if (
            unlocked &&
            request?.kind === "provider-passkey-get" &&
            request.credentialId &&
            passkeyMatches.length === 1 &&
            lastAutoCompletedPasskeyRequestId !== request.id
        ) {
            lastAutoCompletedPasskeyRequestId = request.id;
            void completePasskeyGet(request.credentialId);
        }
    }, [completePasskeyGet, passkeyMatches.length, request, unlocked]);

    const completePasskeyCreate = async () => {
        const rpId = passkeyRequest?.rp?.id;
        if (!request?.requestJson || !rpId || requestGuard()) {
            setRequestError(request?.requestJson ? REQUEST_EXPIRED : "This passkey request is malformed.");
            return;
        }
        const existingIds = credentials
            .filter((credential) => !credential.Deleted && credential.Passkey?.RPID.toLowerCase() === rpId.toLowerCase())
            .map((credential) => credential.Passkey!.CredentialID);
        if (passkeyRequest.excludeCredentials?.some((descriptor) => descriptor.type === "public-key" && !!descriptor.id && existingIds.includes(descriptor.id))) {
            if (!androidCredentials.rejectExcludedPasskeyCreate(request.id)) {
                setRequestError("A passkey for this account already exists.");
            }
            return;
        }
        setBusy(true);
        let stage = "resolve_origin";
        try {
            const resolution = await androidCredentials.resolvePendingPasskeyOrigin(rpId);
            if (!resolution.origin) throw new Error(resolution.errorCode ?? "PASSKEY_ORIGIN_REJECTED");
            stage = "user_verification";
            await verifyPasskeyUser("Create", passkeyRequest.rp?.name ?? rpId);
            if (requestGuard()) throw new Error("PASSKEY_REQUEST_EXPIRED");
            onInteraction();
            stage = "generate_credential";
            const registration = await createAndroidPasskey(
                request.requestJson,
                resolution.origin,
                request.clientDataHash && !resolution.origin.startsWith("android:")
                    ? decodeClientDataHash(request.clientDataHash)
                    : undefined,
                existingIds,
            );
            stage = "persist_vault";
            let serializedGate: string | null = null;
            const result = await persistVaultMutation("credential.upsert", async (current) => {
                serializedGate = requestGuard();
                if (serializedGate) throw new Error("REQUEST_INVALID");
                const saved = await createCredential({
                    ID: null,
                    Type: ItemType.Passkey,
                    DirectoryID: "",
                    Name: passkeyRequest.rp?.name ?? registration.passkey.RPID,
                    Username: registration.passkey.UserName,
                    Password: "",
                    TOTP: null,
                    Tags: "",
                    URL: `https://${registration.passkey.RPID}`,
                    URLMatchMode: CredentialURLMatchMode.ExactHost,
                    AdditionalURLs: [],
                    Passkey: registration.passkey,
                    Notes: "",
                    CustomFields: [],
                });
                const next = Object.assign(new Vault(), current);
                next.Credentials = [...current.Credentials, saved];
                return { vault: next, result: saved };
            });
            if (result.isErr()) throw new Error(serializedGate ?? "PASSKEY_SAVE_FAILED");
            stage = "complete_android_request";
            if (requestGuard() || !androidCredentials.completeProviderPasskeyCreate(request.id, registration.responseJson)) {
                await persistVaultMutation("credential.upsert", (current) => {
                    const next = Object.assign(new Vault(), current);
                    next.Credentials = current.Credentials.filter((credential) => credential.ID !== result.value.ID);
                    return { vault: next, result: undefined };
                });
                throw new Error("PASSKEY_REQUEST_EXPIRED");
            }
            passkeyLog.info("Passkey creation completed");
            returnToVault();
        } catch (error) {
            passkeyLog.error("Passkey creation failed", {
                stage,
                code: passkeyFailureCode(stage, error),
                errorType: error instanceof Error ? error.name : typeof error,
            });
            if (error instanceof Error && error.message === "PASSKEY_USER_VERIFICATION_CANCELLED") {
                androidCredentials.dismissRequest(request.id);
                returnToVault();
                return;
            }
            setRequestError("Could not create and save this passkey.");
            setBusy(false);
        }
    };

    const saveCandidates = useMemo(() => {
        if (!request || !isAutofillSaveRequest(request) || !request.username) return [];
        return matches.filter((credential) => credential.Username === request.username);
    }, [matches, request]);
    const effectiveEditorCredentialId = editorPurpose === "captured"
        ? editorCredentialId === null
            ? undefined
            : editorCredentialId ?? (saveCandidates.length === 1 ? saveCandidates[0]!.ID : undefined)
        : undefined;
    const editorInitialValues = useMemo<Partial<CredentialFormSchemaType>>(() => {
        if (!request) return {};
        const existing = effectiveEditorCredentialId
            ? credentials.find((credential) => credential.ID === effectiveEditorCredentialId)
            : undefined;
        const values: Partial<CredentialFormSchemaType> = {};
        if (!existing) {
            values.Name = defaultAutofillCredentialName(request);
            values.URL = target?.pageUrl ?? target?.appUri ?? "";
            values.URLMatchMode = CredentialURLMatchMode.ExactHost;
        }
        if (request.username != null) values.Username = request.username;
        if (request.password != null) values.Password = request.password;
        if (request.email != null) {
            const currentFields = existing?.CustomFields ?? [];
            const emailField = currentFields.find((field) => field.Name.trim().toLowerCase() === "email");
            values.CustomFields = [
                ...currentFields.filter((field) => field.Name.trim().toLowerCase() !== "email"),
                ...(request.email.trim()
                    ? [{
                          ID: emailField?.ID ?? ulid(),
                          Name: emailField?.Name ?? "Email",
                          Type: emailField?.Type ?? CustomFieldType.Text,
                          Value: request.email.trim(),
                      }]
                    : []),
            ];
        }
        return values;
    }, [credentials, effectiveEditorCredentialId, request, target?.appUri, target?.pageUrl]);

    const handleEditorSaved = () => {
        if (!request) return;
        if (editorPurpose === "add") {
            setView("picker");
            setSelected(null);
            setRequestError("");
            return;
        }
        if (requestGuard()) {
            setRequestError("The login was saved, but the Android request expired before Cryptex Vault could return.");
            return;
        }
        if (request.kind === "provider-password-create") {
            if (!androidCredentials.completeProviderPasswordCreate(request.id)) {
                setRequestError("The login was saved, but Android could not finish the credential request.");
            }
            else returnToVault();
        } else {
            androidCredentials.dismissRequest(request.id);
            returnToVault();
        }
    };

    useEffect(() => {
        if (
            request &&
            view === "editor" &&
            editorPurpose === "captured" &&
            isAutofillSaveRequest(request) &&
            saveCandidates.length > 1 &&
            editorCredentialId === undefined
        ) {
            setView("save-choice");
        }
    }, [editorCredentialId, editorPurpose, request, saveCandidates.length, view]);

    if (!unlocked) {
        return <Redirect href={{ pathname: "/(locked)/manager", params: { returnTo: "/credential-request" } }} />;
    }
    if (!request) {
        return <RequestMessage title="Request expired" message={REQUEST_EXPIRED} onCancel={cancelRequest} />;
    }
    if (request.kind === "provider-unlock") {
        return requestError
            ? <RequestMessage title="Unlock provider" message={requestError} onCancel={cancelRequest} />
            : <RequestProgress title="Unlock provider" label="Returning to Android…" onCancel={cancelRequest} />;
    }
    if (request.kind === "provider-passkey-create") {
        const rpId = passkeyRequest?.rp?.id ?? "Unknown relying party";
        const rpDisplayName = passkeyRequest?.rp?.name;
        return (
            <AutofillRequestShell
                title="Create passkey"
                onBack={cancelRequest}
                backLabel="Cancel passkey creation"
                footer={<View style={{ gap: 10 }}>
                    <UnlockedButton loading={busy} onPress={() => void completePasskeyCreate()}>Create and save</UnlockedButton>
                    <UnlockedButton variant="ghost" disabled={busy} onPress={cancelRequest}>Cancel</UnlockedButton>
                </View>}
            >
                <View style={{ gap: 22 }}>
                    <RequestDestination
                        label={rpId}
                        kind="passkey"
                        detail={rpDisplayName && rpDisplayName !== rpId ? rpDisplayName : "Relying party ID"}
                    />
                    <View style={{ gap: 5 }}>
                        <UnlockedText style={{ color: colors.muted, fontSize: 10, letterSpacing: 1 }}>ACCOUNT</UnlockedText>
                        <UnlockedText style={{ fontSize: 17, fontWeight: "600" }}>
                            {passkeyRequest?.user?.displayName ?? passkeyRequest?.user?.name ?? "Unknown account"}
                        </UnlockedText>
                        {passkeyRequest?.user?.displayName && passkeyRequest.user.name ? (
                            <UnlockedText style={{ color: colors.muted, fontSize: 13 }}>{passkeyRequest.user.name}</UnlockedText>
                        ) : null}
                    </View>
                    {requestError ? <InlineNotice tone="error" message={requestError} /> : null}
                </View>
            </AutofillRequestShell>
        );
    }
    if (request.kind === "provider-passkey-get") {
        return (
            <AutofillRequestShell
                title="Use passkey"
                onBack={cancelRequest}
                backLabel="Cancel passkey request"
                footer={<UnlockedButton variant="ghost" disabled={busy} onPress={cancelRequest}>Cancel</UnlockedButton>}
            >
                <View style={{ gap: 18 }}>
                    <RequestDestination label={passkeyRequest?.rpId ?? "Unknown relying party"} kind="passkey" />
                    {busy && request.credentialId ? (
                        <View style={{ alignItems: "center", gap: 12, paddingVertical: 20 }}>
                            <ActivityIndicator color={colors.primary} />
                            <UnlockedText>Waiting for Android verification…</UnlockedText>
                        </View>
                    ) : passkeyMatches.length ? passkeyMatches.map((credential) => (
                        <Pressable
                            key={credential.ID}
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => void completePasskeyGet(credential.Passkey!.CredentialID)}
                            style={{ minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: 6, backgroundColor: colors.secondary, borderLeftWidth: 2, borderLeftColor: colors.primary }}
                        >
                            <KeyRound size={22} color={colors.primary} />
                            <View style={{ flex: 1 }}>
                                <UnlockedText style={{ fontWeight: "600" }}>{credential.Name}</UnlockedText>
                                <UnlockedText style={{ color: colors.muted, fontSize: 12 }}>
                                    {credential.Passkey?.UserDisplayName || credential.Passkey?.UserName}
                                </UnlockedText>
                            </View>
                            <UnlockedText style={{ color: colors.primary, fontSize: 12 }}>Continue</UnlockedText>
                        </Pressable>
                    )) : <InlineNotice tone="info" message="No passkeys match this request." />}
                    {requestError ? <InlineNotice tone="error" message={requestError} /> : null}
                </View>
            </AutofillRequestShell>
        );
    }
    if (view === "save-choice") {
        return (
            <AutofillRequestShell title="Choose login to update" onBack={cancelRequest}>
                <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
                    More than one saved login has this username. Choose one to update, or save a new login.
                </UnlockedText>
                <View style={{ marginTop: 16 }}>
                    {saveCandidates.map((credential) => (
                        <Pressable
                            key={credential.ID}
                            accessibilityRole="button"
                            onPress={() => { setEditorCredentialId(credential.ID); setView("editor"); }}
                            style={{ minHeight: 64, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}
                        >
                            <UnlockedText style={{ fontWeight: "600" }}>{credential.Name}</UnlockedText>
                            <UnlockedText style={{ color: colors.muted, fontSize: 12 }}>{credential.URL || "No saved website"}</UnlockedText>
                        </Pressable>
                    ))}
                    <UnlockedButton variant="secondary" className="mt-4" onPress={() => { setEditorCredentialId(null); setView("editor"); }}>
                        <Plus size={16} color={colors.primary} />
                        <UnlockedText style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
                            Save new login
                        </UnlockedText>
                    </UnlockedButton>
                </View>
            </AutofillRequestShell>
        );
    }
    if (view === "editor") {
        return (
            <UnlockedConfirmationProvider>
                <CredentialForm
                    key={`${request.id}:${editorPurpose}:${effectiveEditorCredentialId ?? "new"}`}
                    credentialId={effectiveEditorCredentialId}
                    initialValues={editorInitialValues}
                    beforeSave={requestGuard}
                    notice={request.kind === "accessibility-save" && request.password == null ? {
                        tone: "info",
                        message: "Android hid this password from accessibility. Enter it inside Cryptex Vault to save this login.",
                    } : undefined}
                    requirePassword={
                        request.kind === "accessibility-save" &&
                        request.password == null &&
                        !effectiveEditorCredentialId
                    }
                    onSaved={handleEditorSaved}
                    onCancel={() => editorPurpose === "add" ? setView("picker") : cancelRequest()}
                    onSaveError={(_message, code, retry) => {
                        retrySaveRef.current = retry;
                        setSaveFailureCode(code);
                        setSaveFailureOpen(true);
                    }}
                />
                <SaveFailureSheet
                    open={saveFailureOpen}
                    code={saveFailureCode}
                    onClose={() => setSaveFailureOpen(false)}
                    onRetry={() => { setSaveFailureOpen(false); retrySaveRef.current?.(); }}
                />
            </UnlockedConfirmationProvider>
        );
    }
    if (view === "decision" && target) {
        const selectedIsMatch = !!selected && matches.some((credential) => credential.ID === selected.ID);
        return (
            <FillDecisionScreen
                credential={selected}
                target={target}
                warning={[autofillAssociationWarning(target) ?? (selected ? `${selected.Name} is not saved for ${target.displayName}. Check the destination before filling.` : null), accessibilityOriginWarning].filter(Boolean).join(" ") || null}
                canAssociate={!!selected && !selectedIsMatch && canAssociateAutofillTarget(target)}
                busy={busy}
                onClose={() => setView("picker")}
                onFillOnce={() => selected && void completeLogin(selected)}
                onAssociate={() => { setAssociationError(""); setView("associate"); }}
            />
        );
    }
    if (view === "associate" && target && selected) {
        return (
            <AssociationConsentScreen
                credential={selected}
                target={target}
                busy={busy}
                error={associationError}
                onBack={() => setView("decision")}
                onConfirm={() => void persistAssociationAndFill()}
            />
        );
    }
    if (request.kind === "provider-password-get" && providerWebOrigin === undefined) {
        return <RequestProgress title="Verify destination" label="Verifying request…" onCancel={cancelRequest} />;
    }
    if (!target) {
        return <RequestMessage title="Destination unavailable" message="Cryptex Vault could not confirm which app or website requested this login." onCancel={cancelRequest} />;
    }
    return (
        <AutofillPicker
            target={target}
            warning={[autofillAssociationWarning(target), accessibilityOriginWarning].filter(Boolean).join(" ") || null}
            rows={rows}
            matchCount={matches.length}
            eligibleCount={eligibleCredentials.length}
            query={query}
            expanded={expanded}
            busy={busy}
            error={requestError}
            onQueryChange={setQuery}
            onToggleExpanded={() => setExpanded((value) => !value)}
            onChoose={beginFill}
            onAdd={() => { setEditorPurpose("add"); setEditorCredentialId(undefined); setView("editor"); }}
            onCancel={cancelRequest}
        />
    );
}

function RequestProgress({ title, label, onCancel }: { title: string; label: string; onCancel: () => void }) {
    return (
        <AutofillRequestShell title={title} onBack={onCancel}>
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 28 }}>
                <ActivityIndicator color={colors.primary} />
                <UnlockedText>{label}</UnlockedText>
            </View>
        </AutofillRequestShell>
    );
}

function RequestMessage({ title, message, onCancel }: { title: string; message: string; onCancel: () => void }) {
    return (
        <AutofillRequestShell title={title} onBack={onCancel}>
            <InlineNotice tone="error" message={message} />
            <UnlockedButton className="mt-4" onPress={onCancel}>Return to app</UnlockedButton>
        </AutofillRequestShell>
    );
}
