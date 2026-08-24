import {
    PASSKEY_CONTENT_SOURCE,
    PASSKEY_PAGE_SOURCE,
    type PasskeyCreateResult,
} from "./passkey-registration";

const credentials = navigator.credentials;
const nativeCreate = credentials?.create?.bind(credentials);

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
