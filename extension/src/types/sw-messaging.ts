import { EncryptionFormGroupSchemaType } from "@/app_lib/vault-utils/form-schemas";
import { VaultCredential, CredentialFormSchemaType } from "@/app_lib/vault-utils/vault";

export enum MessageType {
    GetState = 0,
    Unlock = 1,
    Lock = 2,
    GetCredentials = 3,
    GetCredential = 4,
    CreateCredential = 5,
    UpdateCredential = 6,
    DeleteCredential = 7,
}

// The payload is defined by the message type
export type Message<T extends MessageType> = {
    type: T;
    payload: MessagePayload[T];
}

export type MessagePayload = {
    [MessageType.GetState]: undefined;
    [MessageType.Unlock]: {
        index?: number;
        form: EncryptionFormGroupSchemaType;
    };
    [MessageType.Lock]: undefined;
    [MessageType.GetCredentials]: undefined;
    [MessageType.GetCredential]: {
        id: string;
    };
    [MessageType.CreateCredential]: {
        form: CredentialFormSchemaType;
    };
    [MessageType.UpdateCredential]: {
        id: string;
        form: CredentialFormSchemaType;
    };
    [MessageType.DeleteCredential]: {
        id: string;
    };
}

export type LiteCredential = {
    id: string;
    name: string;
    username: string;
    url: string;
}

type MessageResponsePayload = {
    [-1]: { error: string }; // Error response
    [MessageType.GetState]: {
        unlocked: boolean;
        metadata: { id?: number; name: string } | null;
    };
    [MessageType.Unlock]: { ok: boolean; error?: string };
    [MessageType.Lock]: { ok: boolean };
    [MessageType.GetCredentials]: { ok: boolean; credentials: LiteCredential[] };
    [MessageType.GetCredential]: { ok: boolean; credential: VaultCredential | null; error?: string };
    [MessageType.CreateCredential]: { ok: boolean; credential: VaultCredential | null; error?: string };
    [MessageType.UpdateCredential]: { ok: boolean; credential: VaultCredential | null; error?: string };
    [MessageType.DeleteCredential]: { ok: boolean; error?: string };
}

// Discriminated unions for better type-narrowing on message handlers
export type AnyMessage =
    | { type: MessageType.GetState; payload: MessagePayload[MessageType.GetState] }
    | { type: MessageType.Unlock; payload: MessagePayload[MessageType.Unlock] }
    | { type: MessageType.Lock; payload: MessagePayload[MessageType.Lock] }
    | { type: MessageType.GetCredentials; payload: MessagePayload[MessageType.GetCredentials] }
    | { type: MessageType.GetCredential; payload: MessagePayload[MessageType.GetCredential] }
    | { type: MessageType.CreateCredential; payload: MessagePayload[MessageType.CreateCredential] }
    | { type: MessageType.UpdateCredential; payload: MessagePayload[MessageType.UpdateCredential] }
    | { type: MessageType.DeleteCredential; payload: MessagePayload[MessageType.DeleteCredential] }

export type AnyMessageResponse =
    | { type: -1; payload: MessageResponsePayload[-1] } // Error response
    | { type: MessageType.GetState; payload: MessageResponsePayload[MessageType.GetState] }
    | { type: MessageType.Unlock; payload: MessageResponsePayload[MessageType.Unlock] }
    | { type: MessageType.Lock; payload: MessageResponsePayload[MessageType.Lock] }
    | { type: MessageType.GetCredentials; payload: MessageResponsePayload[MessageType.GetCredentials] }
    | { type: MessageType.GetCredential; payload: MessageResponsePayload[MessageType.GetCredential] }
    | { type: MessageType.CreateCredential; payload: MessageResponsePayload[MessageType.CreateCredential] }
    | { type: MessageType.UpdateCredential; payload: MessageResponsePayload[MessageType.UpdateCredential] }
    | { type: MessageType.DeleteCredential; payload: MessageResponsePayload[MessageType.DeleteCredential] }