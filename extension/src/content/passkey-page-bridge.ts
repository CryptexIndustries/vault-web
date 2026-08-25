import {
    PASSKEY_CONTENT_SOURCE,
    PASSKEY_PAGE_SOURCE,
    type PasskeyCreateResult,
} from "./passkey-registration";
import {
    decodeBase64Url,
    type PasskeyGetCancel,
    type PasskeyGetRequest,
    type PasskeyGetResult,
} from "./passkey-assertion";

const credentials = navigator.credentials;
const nativeCreate = credentials?.create?.bind(credentials);
const nativeGet = credentials?.get?.bind(credentials);

function base64Url(value: ArrayBuffer): string {
    const data = new Uint8Array(value);
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
}

if (nativeCreate) {
    const pending = new Map<
        string,
        {
            options: CredentialCreationOptions;
            resolve: (value: Credential | null) => void;
            reject: (reason?: unknown) => void;
            timeout: number;
        }
    >();

    const fallBack = (requestId: string) => {
        const request = pending.get(requestId);
        if (!request) return;
        pending.delete(requestId);
        window.clearTimeout(request.timeout);
        void nativeCreate(request.options).then(
            request.resolve,
            request.reject,
        );
    };

    window.addEventListener("message", (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin)
            return;
        const result = event.data as PasskeyCreateResult | undefined;
        if (
            result?.source !== PASSKEY_CONTENT_SOURCE ||
            result.type !== "create-result"
        ) {
            return;
        }
        const request = pending.get(result.requestId);
        if (!request) return;
        if (result.outcome !== "created" || !result.credential) {
            fallBack(result.requestId);
            return;
        }

        pending.delete(result.requestId);
        window.clearTimeout(request.timeout);
        const value = result.credential;
        // WebAuthn wrappers consume the credential structurally. These methods
        // mirror AuthenticatorAttestationResponse without exposing key material.
        const credential = {
            id: value.id,
            rawId: value.rawId,
            type: "public-key",
            authenticatorAttachment: value.authenticatorAttachment,
            getClientExtensionResults: () => ({}),
            response: {
                clientDataJSON: value.clientDataJSON,
                attestationObject: value.attestationObject,
                getAuthenticatorData: () => value.authenticatorData,
                getPublicKey: () => value.publicKey,
                getPublicKeyAlgorithm: () => value.publicKeyAlgorithm,
                getTransports: () => value.transports,
            } as AuthenticatorAttestationResponse,
        } as unknown as PublicKeyCredential;
        credential.toJSON = () => ({
            id: value.id,
            rawId: base64Url(value.rawId),
            type: "public-key",
            authenticatorAttachment: value.authenticatorAttachment,
            clientExtensionResults: {},
            response: {
                clientDataJSON: base64Url(value.clientDataJSON),
                attestationObject: base64Url(value.attestationObject),
                authenticatorData: base64Url(value.authenticatorData),
                publicKey: base64Url(value.publicKey),
                publicKeyAlgorithm: value.publicKeyAlgorithm,
                transports: value.transports,
            },
        });
        request.resolve(credential);
    });

    credentials.create = (options?: CredentialCreationOptions) => {
        if (!options?.publicKey) return nativeCreate(options);
        return new Promise<Credential | null>((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timeout = window.setTimeout(
                () => fallBack(requestId),
                120_000,
            );
            pending.set(requestId, {
                options,
                resolve,
                reject,
                timeout,
            });
            window.postMessage(
                {
                    source: PASSKEY_PAGE_SOURCE,
                    type: "create-request",
                    requestId,
                    publicKey: options.publicKey,
                },
                window.location.origin,
            );
        });
    };
}

if (nativeGet) {
    type PendingGet = {
        options: CredentialRequestOptions;
        resolve: (value: Credential | null) => void;
        reject: (reason?: unknown) => void;
        timeout: number;
        abort?: () => void;
    };
    const pending = new Map<string, PendingGet>();

    const clear = (requestId: string): PendingGet | null => {
        const request = pending.get(requestId);
        if (!request) return null;
        pending.delete(requestId);
        window.clearTimeout(request.timeout);
        request.options.signal?.removeEventListener("abort", request.abort!);
        return request;
    };
    const cancelContentRequest = (requestId: string) => {
        window.postMessage(
            {
                source: PASSKEY_PAGE_SOURCE,
                type: "get-cancel",
                requestId,
            } satisfies PasskeyGetCancel,
            window.location.origin,
        );
    };
    const fallBack = (requestId: string) => {
        const request = clear(requestId);
        if (!request) return;
        cancelContentRequest(requestId);
        void nativeGet(request.options).then(request.resolve, request.reject);
    };

    window.addEventListener("message", (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin)
            return;
        const result = event.data as PasskeyGetResult | undefined;
        if (
            result?.source !== PASSKEY_CONTENT_SOURCE ||
            result.type !== "get-result"
        ) {
            return;
        }
        if (result.outcome === "fallback") {
            fallBack(result.requestId);
            return;
        }
        const request = clear(result.requestId);
        if (!request) return;
        if (!result.assertion) {
            request.reject(
                new DOMException(
                    "The operation was cancelled",
                    "NotAllowedError",
                ),
            );
            return;
        }

        const value = result.assertion;
        const rawId = decodeBase64Url(value.rawId).slice().buffer;
        const clientDataJSON = decodeBase64Url(value.clientDataJSON).slice()
            .buffer;
        const authenticatorData = decodeBase64Url(
            value.authenticatorData,
        ).slice().buffer;
        const signature = decodeBase64Url(value.signature).slice().buffer;
        const userHandle = value.userHandle
            ? decodeBase64Url(value.userHandle).slice().buffer
            : null;
        const credential = {
            id: value.id,
            rawId,
            type: "public-key",
            authenticatorAttachment: value.authenticatorAttachment,
            getClientExtensionResults: () => ({}),
            response: {
                clientDataJSON,
                authenticatorData,
                signature,
                userHandle,
            } as AuthenticatorAssertionResponse,
        } as unknown as PublicKeyCredential;
        credential.toJSON = () => ({
            id: value.id,
            rawId: value.rawId,
            type: "public-key",
            authenticatorAttachment: value.authenticatorAttachment,
            clientExtensionResults: {},
            response: {
                clientDataJSON: value.clientDataJSON,
                authenticatorData: value.authenticatorData,
                signature: value.signature,
                userHandle: value.userHandle,
            },
        });
        request.resolve(credential);
    });

    credentials.get = (options?: CredentialRequestOptions) => {
        if (!options?.publicKey) return nativeGet(options);
        if (options.mediation === "silent") return nativeGet(options);
        const publicKey = options.publicKey;
        if (options.signal?.aborted) {
            return Promise.reject(
                options.signal.reason ??
                    new DOMException("The operation was aborted", "AbortError"),
            );
        }
        return new Promise<Credential | null>((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timeout = window.setTimeout(
                () => fallBack(requestId),
                120_000,
            );
            const abort = () => {
                const request = clear(requestId);
                if (!request) return;
                cancelContentRequest(requestId);
                reject(
                    options.signal?.reason ??
                        new DOMException(
                            "The operation was aborted",
                            "AbortError",
                        ),
                );
            };
            options.signal?.addEventListener("abort", abort, { once: true });
            pending.set(requestId, {
                options,
                resolve,
                reject,
                timeout,
                abort,
            });
            window.postMessage(
                {
                    source: PASSKEY_PAGE_SOURCE,
                    type: "get-request",
                    requestId,
                    publicKey,
                } satisfies PasskeyGetRequest,
                window.location.origin,
            );
        });
    };
}
