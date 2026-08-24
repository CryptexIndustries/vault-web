# Passkey architecture

Cryptex acts as a software platform authenticator. The page-facing bridge
intercepts WebAuthn calls, the isolated content script owns the prompt, and the
encrypted vault stores private key material. Private keys are never returned to
the relying-party page.

## Registration boundaries

1. `passkey-page-bridge.ts` intercepts `navigator.credentials.create()` in the
   page's main world and forwards only the public creation options.
2. `autofill-cs.ts` validates the page/RP relationship, checks the authenticated
   vault session, and obtains the user's explicit save confirmation.
3. `passkey-registration.ts` coordinates key generation and shapes the vault and
   browser response objects. It contains no WebAuthn byte-layout arithmetic.
4. `passkey-authenticator-data.ts` is the protocol boundary. It encodes the
   WebAuthn authenticator data, COSE public key, and `none` attestation object.

The authenticator-data byte order is mandated by WebAuthn and is therefore
necessary:

| Field                 |     Size | Cryptex policy                                                                             |
| --------------------- | -------: | ------------------------------------------------------------------------------------------ |
| RP ID SHA-256 hash    | 32 bytes | Hash the validated RP ID                                                                   |
| Flags                 |   1 byte | Named UP, UV, BE, BS, AT flags                                                             |
| Signature counter     |  4 bytes | Zero for a synchronized passkey                                                            |
| AAGUID                | 16 bytes | Cryptex Vault synchronized software authenticator (`bec1418f-a8c4-4c38-ac6f-3e3e1f9ad0c0`) |
| Credential ID length  |  2 bytes | Unsigned big-endian                                                                        |
| Credential ID         | Variable | 32 random bytes                                                                            |
| Credential public key | Variable | CTAP2-canonical CBOR COSE EC2/ES256 key                                                    |

The encoder uses named constants and `DataView` for big-endian integers. Golden
byte-layout tests live in `extension/tests/passkey-authenticator-data.test.ts`.

## User verification

The current software-authenticator policy treats an authenticated, unlocked
vault session as establishing the user's identity and the explicit **Save
passkey** action as fresh user presence. The returned UV flag is set only after
that action succeeds. A locked vault falls back to the native browser
authenticator.

This is close to Proton Pass's extension flow, where passkey creation is gated by
its unlocked client session and save confirmation. Bitwarden has a more granular
user-verification service and may require a client verification or master
password dialog. **TODO:** Implement vault unlock prompt when per-item reprompt
support is added.

## Reference implementations

- [Bitwarden FIDO2 authenticator service](https://github.com/bitwarden/clients/blob/main/libs/common/src/platform/services/fido2/fido2-authenticator.service.ts)
  keeps credential creation and `generateAuthData` in a dedicated authenticator
  layer, with named flag construction and separate CBOR helpers.
- [Bitwarden page script](https://github.com/bitwarden/clients/blob/main/apps/browser/src/autofill/fido2/content/fido2-page-script.ts)
  intercepts `navigator.credentials.create()` and falls back to the native API.
- [Proton Pass worker service](https://github.com/ProtonMail/WebClients/blob/main/applications/pass-extension/src/app/worker/services/passkey.ts)
  delegates generation and assertion to Proton's Rust/WASM core.
- [Proton Pass WebAuthn bridge](https://github.com/ProtonMail/WebClients/blob/main/applications/pass-extension/src/app/content/webauthn.ts)
  performs main-world interception and reconstructs browser credential objects.

## Remaining production parity - a TODO list, if you will...

Registration currently supports ES256. Full authenticator parity still requires
`navigator.credentials.get()` assertions, exclusion-list checks, related-origin
validation, WebAuthn extensions, and a dedicated fresh user-verification flow.
