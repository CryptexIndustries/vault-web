/* eslint-disable */
import Long from "long";
import _m0 from "protobufjs/minimal";

export const protobufPackage = "VaultUtilTypes";

export enum EncryptionAlgorithm {
    AES256 = 0,
    XChaCha20Poly1305 = 1,
}

export enum KeyDerivationFunction {
    PBKDF2 = 0,
    Argon2ID = 1,
}

export enum ItemType {
    SSHKey = 0,
    Credentials = 1,
    Note = 2,
    Identity = 3,
}

export enum CustomFieldType {
    Text = 0,
    MaskedText = 1,
    Boolean = 2,
    Date = 3,
}

export enum TOTPAlgorithm {
    SHA1 = 0,
    SHA256 = 1,
    SHA512 = 2,
}

export enum DiffType {
    Add = 0,
    Delete = 1,
    Update = 2,
}

/** #region Synchronization Message */
export enum SynchronizationMessageCommand {
    SyncRequest = 0,
    SyncResponseAllHashes = 1,
    SyncResponse = 2,
    DivergenceSolveRequest = 3,
    DivergenceSolve = 4,
    LinkedDevicesList = 5,
}

/** #region Encryption */
export interface KeyDerivationConfigArgon2ID {
    memLimit: number;
    opsLimit: number;
}

export interface KeyDerivationConfigPBKDF2 {
    iterations: number;
}

/** #region Vault Metadata */
export interface VaultMetadata {
    /** The version of the vault as the point of creation */
    Version: number;
    DBIndex?: number | undefined;
    Name: string;
    Description: string;
    CreatedAt: string;
    LastUsed?: string | undefined;
    Icon: string;
    Color: string;
    Blob?: EncryptedBlob | undefined;
}

export interface EncryptedBlob {
    /** The version of the vault as the point of creation */
    Version: number;
    /** The current version of the vault, which chages when the vault is upgraded */
    CurrentVersion: number;
    Algorithm: EncryptionAlgorithm;
    KeyDerivationFunc: KeyDerivationFunction;
    KDFConfigArgon2ID: KeyDerivationConfigArgon2ID | undefined;
    KDFConfigPBKDF2: KeyDerivationConfigPBKDF2 | undefined;
    Blob: Uint8Array;
    Salt: string;
    HeaderIV: string;
}

export interface Group {
    ID: string;
    Name: string;
    Icon: string;
    Color: string;
}

export interface CustomField {
    ID: string;
    Name: string;
    Type: CustomFieldType;
    Value: string;
}

export interface Vault {
    /** The version of the vault as the point of creation */
    Version: number;
    /** The current version of the vault, which chages when the vault is upgraded */
    CurrentVersion: number;
    Configuration: Configuration | undefined;
    OnlineServices: OnlineServices | undefined;
    Groups: Group[];
    Credentials: Credential[];
    Diffs: Diff[];
}

export interface Configuration {
    MaxDiffCount: number;
}

/** #region OnlineServices */
export interface OnlineServices {
    UserID?: string | undefined;
    PublicKey?: string | undefined;
    PrivateKey?: string | undefined;
    CreationTimestamp: number;
    LinkedDevices: LinkedDevice[];
}

export interface LinkedDevice {
    ID: string;
    Name: string;
    LastSync?: string | undefined;
    IsRoot: boolean;
    LinkedAtTimestamp: number;
    AutoConnect: boolean;
    SyncTimeout: boolean;
    SyncTimeoutPeriod: number;
}

/** #region Credentials */
export interface Credential {
    ID: string;
    Type: ItemType;
    GroupID: string;
    Name: string;
    Username: string;
    Password: string;
    TOTP?: TOTP | undefined;
    Tags?: string | undefined;
    URL: string;
    Notes: string;
    DateCreated: string;
    DateModified?: string | undefined;
    DatePasswordChanged?: string | undefined;
    CustomFields: CustomField[];
    /** NOTE: This property is not synchronized across devices ATM (meaning, it isn't present in the PartialCredential object) */
    Hash?: string | undefined;
}

/** All optional version of the Credential object */
export interface PartialCredential {
    ID?: string | undefined;
    Type?: ItemType | undefined;
    GroupID?: string | undefined;
    Name?: string | undefined;
    Username?: string | undefined;
    Password?: string | undefined;
    TOTP?: TOTP | undefined;
    Tags?: string | undefined;
    URL?: string | undefined;
    Notes?: string | undefined;
    DateCreated?: string | undefined;
    DateModified?: string | undefined;
    DatePasswordChanged?: string | undefined;
    CustomFields: CustomField[];
    ChangeFlags?: PartialCredentialChanges | undefined;
}

export interface PartialCredentialChanges {
    TypeHasChanged: boolean;
    GroupIDHasChanged: boolean;
    NameHasChanged: boolean;
    UsernameHasChanged: boolean;
    PasswordHasChanged: boolean;
    TOTPHasChanged: boolean;
    TagsHasChanged: boolean;
    URLHasChanged: boolean;
    NotesHasChanged: boolean;
    DateCreatedHasChanged: boolean;
    DateModifiedHasChanged: boolean;
    DatePasswordChangedHasChanged: boolean;
    CustomFieldsHasChanged: boolean;
}

export interface TOTP {
    Label: string;
    Secret: string;
    Period: number;
    Digits: number;
    Algorithm: TOTPAlgorithm;
}

/** #region Diff */
export interface Diff {
    /** The hash of the vault after the change */
    Hash: string;
    /** The changes that were made */
    Changes?: DiffChange | undefined;
}

export interface DiffChange {
    /** The type of change */
    Type: DiffType;
    /** The ID of the item that was changed */
    ID: string;
    /** The new value(s) of the item */
    Props?: PartialCredential | undefined;
}

export interface SynchronizationMessage {
    Command: SynchronizationMessageCommand;
    Hash?: string | undefined;
    DivergenceHash?: string | undefined;
    Diffs: Diff[];
    LinkedDevices: LinkedDevice[];
}

function createBaseKeyDerivationConfigArgon2ID(): KeyDerivationConfigArgon2ID {
    return { memLimit: 0, opsLimit: 0 };
}

export const KeyDerivationConfigArgon2ID = {
    encode(
        message: KeyDerivationConfigArgon2ID,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.memLimit !== 0) {
            writer.uint32(56).int32(message.memLimit);
        }
        if (message.opsLimit !== 0) {
            writer.uint32(64).int32(message.opsLimit);
        }
        return writer;
    },

    decode(
        input: _m0.Reader | Uint8Array,
        length?: number,
    ): KeyDerivationConfigArgon2ID {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseKeyDerivationConfigArgon2ID();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 7:
                    if (tag !== 56) {
                        break;
                    }

                    message.memLimit = reader.int32();
                    continue;
                case 8:
                    if (tag !== 64) {
                        break;
                    }

                    message.opsLimit = reader.int32();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<KeyDerivationConfigArgon2ID>, I>>(
        base?: I,
    ): KeyDerivationConfigArgon2ID {
        return KeyDerivationConfigArgon2ID.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<KeyDerivationConfigArgon2ID>, I>>(
        object: I,
    ): KeyDerivationConfigArgon2ID {
        const message = createBaseKeyDerivationConfigArgon2ID();
        message.memLimit = object.memLimit ?? 0;
        message.opsLimit = object.opsLimit ?? 0;
        return message;
    },
};

function createBaseKeyDerivationConfigPBKDF2(): KeyDerivationConfigPBKDF2 {
    return { iterations: 0 };
}

export const KeyDerivationConfigPBKDF2 = {
    encode(
        message: KeyDerivationConfigPBKDF2,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.iterations !== 0) {
            writer.uint32(32).int32(message.iterations);
        }
        return writer;
    },

    decode(
        input: _m0.Reader | Uint8Array,
        length?: number,
    ): KeyDerivationConfigPBKDF2 {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseKeyDerivationConfigPBKDF2();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 4:
                    if (tag !== 32) {
                        break;
                    }

                    message.iterations = reader.int32();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<KeyDerivationConfigPBKDF2>, I>>(
        base?: I,
    ): KeyDerivationConfigPBKDF2 {
        return KeyDerivationConfigPBKDF2.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<KeyDerivationConfigPBKDF2>, I>>(
        object: I,
    ): KeyDerivationConfigPBKDF2 {
        const message = createBaseKeyDerivationConfigPBKDF2();
        message.iterations = object.iterations ?? 0;
        return message;
    },
};

function createBaseVaultMetadata(): VaultMetadata {
    return {
        Version: 0,
        Name: "",
        Description: "",
        CreatedAt: "",
        Icon: "",
        Color: "",
    };
}

export const VaultMetadata = {
    encode(
        message: VaultMetadata,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Version !== 0) {
            writer.uint32(8).int32(message.Version);
        }
        if (message.DBIndex !== undefined) {
            writer.uint32(16).int32(message.DBIndex);
        }
        if (message.Name !== "") {
            writer.uint32(26).string(message.Name);
        }
        if (message.Description !== "") {
            writer.uint32(34).string(message.Description);
        }
        if (message.CreatedAt !== "") {
            writer.uint32(42).string(message.CreatedAt);
        }
        if (message.LastUsed !== undefined) {
            writer.uint32(50).string(message.LastUsed);
        }
        if (message.Icon !== "") {
            writer.uint32(58).string(message.Icon);
        }
        if (message.Color !== "") {
            writer.uint32(66).string(message.Color);
        }
        if (message.Blob !== undefined) {
            EncryptedBlob.encode(
                message.Blob,
                writer.uint32(74).fork(),
            ).ldelim();
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): VaultMetadata {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseVaultMetadata();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.Version = reader.int32();
                    continue;
                case 2:
                    if (tag !== 16) {
                        break;
                    }

                    message.DBIndex = reader.int32();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.Name = reader.string();
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.Description = reader.string();
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.CreatedAt = reader.string();
                    continue;
                case 6:
                    if (tag !== 50) {
                        break;
                    }

                    message.LastUsed = reader.string();
                    continue;
                case 7:
                    if (tag !== 58) {
                        break;
                    }

                    message.Icon = reader.string();
                    continue;
                case 8:
                    if (tag !== 66) {
                        break;
                    }

                    message.Color = reader.string();
                    continue;
                case 9:
                    if (tag !== 74) {
                        break;
                    }

                    message.Blob = EncryptedBlob.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<VaultMetadata>, I>>(
        base?: I,
    ): VaultMetadata {
        return VaultMetadata.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<VaultMetadata>, I>>(
        object: I,
    ): VaultMetadata {
        const message = createBaseVaultMetadata();
        message.Version = object.Version ?? 0;
        message.DBIndex = object.DBIndex ?? undefined;
        message.Name = object.Name ?? "";
        message.Description = object.Description ?? "";
        message.CreatedAt = object.CreatedAt ?? "";
        message.LastUsed = object.LastUsed ?? undefined;
        message.Icon = object.Icon ?? "";
        message.Color = object.Color ?? "";
        message.Blob =
            object.Blob !== undefined && object.Blob !== null
                ? EncryptedBlob.fromPartial(object.Blob)
                : undefined;
        return message;
    },
};

function createBaseEncryptedBlob(): EncryptedBlob {
    return {
        Version: 0,
        CurrentVersion: 0,
        Algorithm: 0,
        KeyDerivationFunc: 0,
        KDFConfigArgon2ID: undefined,
        KDFConfigPBKDF2: undefined,
        Blob: new Uint8Array(0),
        Salt: "",
        HeaderIV: "",
    };
}

export const EncryptedBlob = {
    encode(
        message: EncryptedBlob,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Version !== 0) {
            writer.uint32(64).int32(message.Version);
        }
        if (message.CurrentVersion !== 0) {
            writer.uint32(72).int32(message.CurrentVersion);
        }
        if (message.Algorithm !== 0) {
            writer.uint32(8).int32(message.Algorithm);
        }
        if (message.KeyDerivationFunc !== 0) {
            writer.uint32(16).int32(message.KeyDerivationFunc);
        }
        if (message.KDFConfigArgon2ID !== undefined) {
            KeyDerivationConfigArgon2ID.encode(
                message.KDFConfigArgon2ID,
                writer.uint32(26).fork(),
            ).ldelim();
        }
        if (message.KDFConfigPBKDF2 !== undefined) {
            KeyDerivationConfigPBKDF2.encode(
                message.KDFConfigPBKDF2,
                writer.uint32(34).fork(),
            ).ldelim();
        }
        if (message.Blob.length !== 0) {
            writer.uint32(42).bytes(message.Blob);
        }
        if (message.Salt !== "") {
            writer.uint32(50).string(message.Salt);
        }
        if (message.HeaderIV !== "") {
            writer.uint32(58).string(message.HeaderIV);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): EncryptedBlob {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseEncryptedBlob();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 8:
                    if (tag !== 64) {
                        break;
                    }

                    message.Version = reader.int32();
                    continue;
                case 9:
                    if (tag !== 72) {
                        break;
                    }

                    message.CurrentVersion = reader.int32();
                    continue;
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.Algorithm = reader.int32() as any;
                    continue;
                case 2:
                    if (tag !== 16) {
                        break;
                    }

                    message.KeyDerivationFunc = reader.int32() as any;
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.KDFConfigArgon2ID =
                        KeyDerivationConfigArgon2ID.decode(
                            reader,
                            reader.uint32(),
                        );
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.KDFConfigPBKDF2 = KeyDerivationConfigPBKDF2.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.Blob = reader.bytes();
                    continue;
                case 6:
                    if (tag !== 50) {
                        break;
                    }

                    message.Salt = reader.string();
                    continue;
                case 7:
                    if (tag !== 58) {
                        break;
                    }

                    message.HeaderIV = reader.string();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<EncryptedBlob>, I>>(
        base?: I,
    ): EncryptedBlob {
        return EncryptedBlob.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<EncryptedBlob>, I>>(
        object: I,
    ): EncryptedBlob {
        const message = createBaseEncryptedBlob();
        message.Version = object.Version ?? 0;
        message.CurrentVersion = object.CurrentVersion ?? 0;
        message.Algorithm = object.Algorithm ?? 0;
        message.KeyDerivationFunc = object.KeyDerivationFunc ?? 0;
        message.KDFConfigArgon2ID =
            object.KDFConfigArgon2ID !== undefined &&
            object.KDFConfigArgon2ID !== null
                ? KeyDerivationConfigArgon2ID.fromPartial(
                      object.KDFConfigArgon2ID,
                  )
                : undefined;
        message.KDFConfigPBKDF2 =
            object.KDFConfigPBKDF2 !== undefined &&
            object.KDFConfigPBKDF2 !== null
                ? KeyDerivationConfigPBKDF2.fromPartial(object.KDFConfigPBKDF2)
                : undefined;
        message.Blob = object.Blob ?? new Uint8Array(0);
        message.Salt = object.Salt ?? "";
        message.HeaderIV = object.HeaderIV ?? "";
        return message;
    },
};

function createBaseGroup(): Group {
    return { ID: "", Name: "", Icon: "", Color: "" };
}

export const Group = {
    encode(
        message: Group,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.ID !== "") {
            writer.uint32(10).string(message.ID);
        }
        if (message.Name !== "") {
            writer.uint32(18).string(message.Name);
        }
        if (message.Icon !== "") {
            writer.uint32(26).string(message.Icon);
        }
        if (message.Color !== "") {
            writer.uint32(34).string(message.Color);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): Group {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseGroup();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.ID = reader.string();
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.Name = reader.string();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.Icon = reader.string();
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.Color = reader.string();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<Group>, I>>(base?: I): Group {
        return Group.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<Group>, I>>(object: I): Group {
        const message = createBaseGroup();
        message.ID = object.ID ?? "";
        message.Name = object.Name ?? "";
        message.Icon = object.Icon ?? "";
        message.Color = object.Color ?? "";
        return message;
    },
};

function createBaseCustomField(): CustomField {
    return { ID: "", Name: "", Type: 0, Value: "" };
}

export const CustomField = {
    encode(
        message: CustomField,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.ID !== "") {
            writer.uint32(10).string(message.ID);
        }
        if (message.Name !== "") {
            writer.uint32(18).string(message.Name);
        }
        if (message.Type !== 0) {
            writer.uint32(24).int32(message.Type);
        }
        if (message.Value !== "") {
            writer.uint32(34).string(message.Value);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): CustomField {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseCustomField();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.ID = reader.string();
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.Name = reader.string();
                    continue;
                case 3:
                    if (tag !== 24) {
                        break;
                    }

                    message.Type = reader.int32() as any;
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.Value = reader.string();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<CustomField>, I>>(
        base?: I,
    ): CustomField {
        return CustomField.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<CustomField>, I>>(
        object: I,
    ): CustomField {
        const message = createBaseCustomField();
        message.ID = object.ID ?? "";
        message.Name = object.Name ?? "";
        message.Type = object.Type ?? 0;
        message.Value = object.Value ?? "";
        return message;
    },
};

function createBaseVault(): Vault {
    return {
        Version: 0,
        CurrentVersion: 0,
        Configuration: undefined,
        OnlineServices: undefined,
        Groups: [],
        Credentials: [],
        Diffs: [],
    };
}

export const Vault = {
    encode(
        message: Vault,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Version !== 0) {
            writer.uint32(8).int32(message.Version);
        }
        if (message.CurrentVersion !== 0) {
            writer.uint32(64).int32(message.CurrentVersion);
        }
        if (message.Configuration !== undefined) {
            Configuration.encode(
                message.Configuration,
                writer.uint32(26).fork(),
            ).ldelim();
        }
        if (message.OnlineServices !== undefined) {
            OnlineServices.encode(
                message.OnlineServices,
                writer.uint32(34).fork(),
            ).ldelim();
        }
        for (const v of message.Groups) {
            Group.encode(v!, writer.uint32(42).fork()).ldelim();
        }
        for (const v of message.Credentials) {
            Credential.encode(v!, writer.uint32(50).fork()).ldelim();
        }
        for (const v of message.Diffs) {
            Diff.encode(v!, writer.uint32(58).fork()).ldelim();
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): Vault {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseVault();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.Version = reader.int32();
                    continue;
                case 8:
                    if (tag !== 64) {
                        break;
                    }

                    message.CurrentVersion = reader.int32();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.Configuration = Configuration.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.OnlineServices = OnlineServices.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.Groups.push(Group.decode(reader, reader.uint32()));
                    continue;
                case 6:
                    if (tag !== 50) {
                        break;
                    }

                    message.Credentials.push(
                        Credential.decode(reader, reader.uint32()),
                    );
                    continue;
                case 7:
                    if (tag !== 58) {
                        break;
                    }

                    message.Diffs.push(Diff.decode(reader, reader.uint32()));
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<Vault>, I>>(base?: I): Vault {
        return Vault.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<Vault>, I>>(object: I): Vault {
        const message = createBaseVault();
        message.Version = object.Version ?? 0;
        message.CurrentVersion = object.CurrentVersion ?? 0;
        message.Configuration =
            object.Configuration !== undefined && object.Configuration !== null
                ? Configuration.fromPartial(object.Configuration)
                : undefined;
        message.OnlineServices =
            object.OnlineServices !== undefined &&
            object.OnlineServices !== null
                ? OnlineServices.fromPartial(object.OnlineServices)
                : undefined;
        message.Groups = object.Groups?.map((e) => Group.fromPartial(e)) || [];
        message.Credentials =
            object.Credentials?.map((e) => Credential.fromPartial(e)) || [];
        message.Diffs = object.Diffs?.map((e) => Diff.fromPartial(e)) || [];
        return message;
    },
};

function createBaseConfiguration(): Configuration {
    return { MaxDiffCount: 0 };
}

export const Configuration = {
    encode(
        message: Configuration,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.MaxDiffCount !== 0) {
            writer.uint32(8).int32(message.MaxDiffCount);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): Configuration {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseConfiguration();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.MaxDiffCount = reader.int32();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<Configuration>, I>>(
        base?: I,
    ): Configuration {
        return Configuration.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<Configuration>, I>>(
        object: I,
    ): Configuration {
        const message = createBaseConfiguration();
        message.MaxDiffCount = object.MaxDiffCount ?? 0;
        return message;
    },
};

function createBaseOnlineServices(): OnlineServices {
    return { CreationTimestamp: 0, LinkedDevices: [] };
}

export const OnlineServices = {
    encode(
        message: OnlineServices,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.UserID !== undefined) {
            writer.uint32(10).string(message.UserID);
        }
        if (message.PublicKey !== undefined) {
            writer.uint32(18).string(message.PublicKey);
        }
        if (message.PrivateKey !== undefined) {
            writer.uint32(26).string(message.PrivateKey);
        }
        if (message.CreationTimestamp !== 0) {
            writer.uint32(32).int64(message.CreationTimestamp);
        }
        for (const v of message.LinkedDevices) {
            LinkedDevice.encode(v!, writer.uint32(42).fork()).ldelim();
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): OnlineServices {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseOnlineServices();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.UserID = reader.string();
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.PublicKey = reader.string();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.PrivateKey = reader.string();
                    continue;
                case 4:
                    if (tag !== 32) {
                        break;
                    }

                    message.CreationTimestamp = longToNumber(
                        reader.int64() as Long,
                    );
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.LinkedDevices.push(
                        LinkedDevice.decode(reader, reader.uint32()),
                    );
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<OnlineServices>, I>>(
        base?: I,
    ): OnlineServices {
        return OnlineServices.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<OnlineServices>, I>>(
        object: I,
    ): OnlineServices {
        const message = createBaseOnlineServices();
        message.UserID = object.UserID ?? undefined;
        message.PublicKey = object.PublicKey ?? undefined;
        message.PrivateKey = object.PrivateKey ?? undefined;
        message.CreationTimestamp = object.CreationTimestamp ?? 0;
        message.LinkedDevices =
            object.LinkedDevices?.map((e) => LinkedDevice.fromPartial(e)) || [];
        return message;
    },
};

function createBaseLinkedDevice(): LinkedDevice {
    return {
        ID: "",
        Name: "",
        IsRoot: false,
        LinkedAtTimestamp: 0,
        AutoConnect: false,
        SyncTimeout: false,
        SyncTimeoutPeriod: 0,
    };
}

export const LinkedDevice = {
    encode(
        message: LinkedDevice,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.ID !== "") {
            writer.uint32(10).string(message.ID);
        }
        if (message.Name !== "") {
            writer.uint32(18).string(message.Name);
        }
        if (message.LastSync !== undefined) {
            writer.uint32(26).string(message.LastSync);
        }
        if (message.IsRoot === true) {
            writer.uint32(32).bool(message.IsRoot);
        }
        if (message.LinkedAtTimestamp !== 0) {
            writer.uint32(40).int64(message.LinkedAtTimestamp);
        }
        if (message.AutoConnect === true) {
            writer.uint32(48).bool(message.AutoConnect);
        }
        if (message.SyncTimeout === true) {
            writer.uint32(56).bool(message.SyncTimeout);
        }
        if (message.SyncTimeoutPeriod !== 0) {
            writer.uint32(64).int32(message.SyncTimeoutPeriod);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): LinkedDevice {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseLinkedDevice();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.ID = reader.string();
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.Name = reader.string();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.LastSync = reader.string();
                    continue;
                case 4:
                    if (tag !== 32) {
                        break;
                    }

                    message.IsRoot = reader.bool();
                    continue;
                case 5:
                    if (tag !== 40) {
                        break;
                    }

                    message.LinkedAtTimestamp = longToNumber(
                        reader.int64() as Long,
                    );
                    continue;
                case 6:
                    if (tag !== 48) {
                        break;
                    }

                    message.AutoConnect = reader.bool();
                    continue;
                case 7:
                    if (tag !== 56) {
                        break;
                    }

                    message.SyncTimeout = reader.bool();
                    continue;
                case 8:
                    if (tag !== 64) {
                        break;
                    }

                    message.SyncTimeoutPeriod = reader.int32();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<LinkedDevice>, I>>(
        base?: I,
    ): LinkedDevice {
        return LinkedDevice.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<LinkedDevice>, I>>(
        object: I,
    ): LinkedDevice {
        const message = createBaseLinkedDevice();
        message.ID = object.ID ?? "";
        message.Name = object.Name ?? "";
        message.LastSync = object.LastSync ?? undefined;
        message.IsRoot = object.IsRoot ?? false;
        message.LinkedAtTimestamp = object.LinkedAtTimestamp ?? 0;
        message.AutoConnect = object.AutoConnect ?? false;
        message.SyncTimeout = object.SyncTimeout ?? false;
        message.SyncTimeoutPeriod = object.SyncTimeoutPeriod ?? 0;
        return message;
    },
};

function createBaseCredential(): Credential {
    return {
        ID: "",
        Type: 0,
        GroupID: "",
        Name: "",
        Username: "",
        Password: "",
        URL: "",
        Notes: "",
        DateCreated: "",
        CustomFields: [],
    };
}

export const Credential = {
    encode(
        message: Credential,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.ID !== "") {
            writer.uint32(10).string(message.ID);
        }
        if (message.Type !== 0) {
            writer.uint32(16).int32(message.Type);
        }
        if (message.GroupID !== "") {
            writer.uint32(26).string(message.GroupID);
        }
        if (message.Name !== "") {
            writer.uint32(34).string(message.Name);
        }
        if (message.Username !== "") {
            writer.uint32(42).string(message.Username);
        }
        if (message.Password !== "") {
            writer.uint32(50).string(message.Password);
        }
        if (message.TOTP !== undefined) {
            TOTP.encode(message.TOTP, writer.uint32(58).fork()).ldelim();
        }
        if (message.Tags !== undefined) {
            writer.uint32(66).string(message.Tags);
        }
        if (message.URL !== "") {
            writer.uint32(74).string(message.URL);
        }
        if (message.Notes !== "") {
            writer.uint32(82).string(message.Notes);
        }
        if (message.DateCreated !== "") {
            writer.uint32(90).string(message.DateCreated);
        }
        if (message.DateModified !== undefined) {
            writer.uint32(98).string(message.DateModified);
        }
        if (message.DatePasswordChanged !== undefined) {
            writer.uint32(106).string(message.DatePasswordChanged);
        }
        for (const v of message.CustomFields) {
            CustomField.encode(v!, writer.uint32(114).fork()).ldelim();
        }
        if (message.Hash !== undefined) {
            writer.uint32(122).string(message.Hash);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): Credential {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseCredential();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.ID = reader.string();
                    continue;
                case 2:
                    if (tag !== 16) {
                        break;
                    }

                    message.Type = reader.int32() as any;
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.GroupID = reader.string();
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.Name = reader.string();
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.Username = reader.string();
                    continue;
                case 6:
                    if (tag !== 50) {
                        break;
                    }

                    message.Password = reader.string();
                    continue;
                case 7:
                    if (tag !== 58) {
                        break;
                    }

                    message.TOTP = TOTP.decode(reader, reader.uint32());
                    continue;
                case 8:
                    if (tag !== 66) {
                        break;
                    }

                    message.Tags = reader.string();
                    continue;
                case 9:
                    if (tag !== 74) {
                        break;
                    }

                    message.URL = reader.string();
                    continue;
                case 10:
                    if (tag !== 82) {
                        break;
                    }

                    message.Notes = reader.string();
                    continue;
                case 11:
                    if (tag !== 90) {
                        break;
                    }

                    message.DateCreated = reader.string();
                    continue;
                case 12:
                    if (tag !== 98) {
                        break;
                    }

                    message.DateModified = reader.string();
                    continue;
                case 13:
                    if (tag !== 106) {
                        break;
                    }

                    message.DatePasswordChanged = reader.string();
                    continue;
                case 14:
                    if (tag !== 114) {
                        break;
                    }

                    message.CustomFields.push(
                        CustomField.decode(reader, reader.uint32()),
                    );
                    continue;
                case 15:
                    if (tag !== 122) {
                        break;
                    }

                    message.Hash = reader.string();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<Credential>, I>>(base?: I): Credential {
        return Credential.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<Credential>, I>>(
        object: I,
    ): Credential {
        const message = createBaseCredential();
        message.ID = object.ID ?? "";
        message.Type = object.Type ?? 0;
        message.GroupID = object.GroupID ?? "";
        message.Name = object.Name ?? "";
        message.Username = object.Username ?? "";
        message.Password = object.Password ?? "";
        message.TOTP =
            object.TOTP !== undefined && object.TOTP !== null
                ? TOTP.fromPartial(object.TOTP)
                : undefined;
        message.Tags = object.Tags ?? undefined;
        message.URL = object.URL ?? "";
        message.Notes = object.Notes ?? "";
        message.DateCreated = object.DateCreated ?? "";
        message.DateModified = object.DateModified ?? undefined;
        message.DatePasswordChanged = object.DatePasswordChanged ?? undefined;
        message.CustomFields =
            object.CustomFields?.map((e) => CustomField.fromPartial(e)) || [];
        message.Hash = object.Hash ?? undefined;
        return message;
    },
};

function createBasePartialCredential(): PartialCredential {
    return { CustomFields: [] };
}

export const PartialCredential = {
    encode(
        message: PartialCredential,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.ID !== undefined) {
            writer.uint32(10).string(message.ID);
        }
        if (message.Type !== undefined) {
            writer.uint32(16).int32(message.Type);
        }
        if (message.GroupID !== undefined) {
            writer.uint32(26).string(message.GroupID);
        }
        if (message.Name !== undefined) {
            writer.uint32(34).string(message.Name);
        }
        if (message.Username !== undefined) {
            writer.uint32(42).string(message.Username);
        }
        if (message.Password !== undefined) {
            writer.uint32(50).string(message.Password);
        }
        if (message.TOTP !== undefined) {
            TOTP.encode(message.TOTP, writer.uint32(58).fork()).ldelim();
        }
        if (message.Tags !== undefined) {
            writer.uint32(66).string(message.Tags);
        }
        if (message.URL !== undefined) {
            writer.uint32(74).string(message.URL);
        }
        if (message.Notes !== undefined) {
            writer.uint32(82).string(message.Notes);
        }
        if (message.DateCreated !== undefined) {
            writer.uint32(90).string(message.DateCreated);
        }
        if (message.DateModified !== undefined) {
            writer.uint32(98).string(message.DateModified);
        }
        if (message.DatePasswordChanged !== undefined) {
            writer.uint32(106).string(message.DatePasswordChanged);
        }
        for (const v of message.CustomFields) {
            CustomField.encode(v!, writer.uint32(114).fork()).ldelim();
        }
        if (message.ChangeFlags !== undefined) {
            PartialCredentialChanges.encode(
                message.ChangeFlags,
                writer.uint32(122).fork(),
            ).ldelim();
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): PartialCredential {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBasePartialCredential();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.ID = reader.string();
                    continue;
                case 2:
                    if (tag !== 16) {
                        break;
                    }

                    message.Type = reader.int32() as any;
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.GroupID = reader.string();
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.Name = reader.string();
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.Username = reader.string();
                    continue;
                case 6:
                    if (tag !== 50) {
                        break;
                    }

                    message.Password = reader.string();
                    continue;
                case 7:
                    if (tag !== 58) {
                        break;
                    }

                    message.TOTP = TOTP.decode(reader, reader.uint32());
                    continue;
                case 8:
                    if (tag !== 66) {
                        break;
                    }

                    message.Tags = reader.string();
                    continue;
                case 9:
                    if (tag !== 74) {
                        break;
                    }

                    message.URL = reader.string();
                    continue;
                case 10:
                    if (tag !== 82) {
                        break;
                    }

                    message.Notes = reader.string();
                    continue;
                case 11:
                    if (tag !== 90) {
                        break;
                    }

                    message.DateCreated = reader.string();
                    continue;
                case 12:
                    if (tag !== 98) {
                        break;
                    }

                    message.DateModified = reader.string();
                    continue;
                case 13:
                    if (tag !== 106) {
                        break;
                    }

                    message.DatePasswordChanged = reader.string();
                    continue;
                case 14:
                    if (tag !== 114) {
                        break;
                    }

                    message.CustomFields.push(
                        CustomField.decode(reader, reader.uint32()),
                    );
                    continue;
                case 15:
                    if (tag !== 122) {
                        break;
                    }

                    message.ChangeFlags = PartialCredentialChanges.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<PartialCredential>, I>>(
        base?: I,
    ): PartialCredential {
        return PartialCredential.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<PartialCredential>, I>>(
        object: I,
    ): PartialCredential {
        const message = createBasePartialCredential();
        message.ID = object.ID ?? undefined;
        message.Type = object.Type ?? undefined;
        message.GroupID = object.GroupID ?? undefined;
        message.Name = object.Name ?? undefined;
        message.Username = object.Username ?? undefined;
        message.Password = object.Password ?? undefined;
        message.TOTP =
            object.TOTP !== undefined && object.TOTP !== null
                ? TOTP.fromPartial(object.TOTP)
                : undefined;
        message.Tags = object.Tags ?? undefined;
        message.URL = object.URL ?? undefined;
        message.Notes = object.Notes ?? undefined;
        message.DateCreated = object.DateCreated ?? undefined;
        message.DateModified = object.DateModified ?? undefined;
        message.DatePasswordChanged = object.DatePasswordChanged ?? undefined;
        message.CustomFields =
            object.CustomFields?.map((e) => CustomField.fromPartial(e)) || [];
        message.ChangeFlags =
            object.ChangeFlags !== undefined && object.ChangeFlags !== null
                ? PartialCredentialChanges.fromPartial(object.ChangeFlags)
                : undefined;
        return message;
    },
};

function createBasePartialCredentialChanges(): PartialCredentialChanges {
    return {
        TypeHasChanged: false,
        GroupIDHasChanged: false,
        NameHasChanged: false,
        UsernameHasChanged: false,
        PasswordHasChanged: false,
        TOTPHasChanged: false,
        TagsHasChanged: false,
        URLHasChanged: false,
        NotesHasChanged: false,
        DateCreatedHasChanged: false,
        DateModifiedHasChanged: false,
        DatePasswordChangedHasChanged: false,
        CustomFieldsHasChanged: false,
    };
}

export const PartialCredentialChanges = {
    encode(
        message: PartialCredentialChanges,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.TypeHasChanged === true) {
            writer.uint32(8).bool(message.TypeHasChanged);
        }
        if (message.GroupIDHasChanged === true) {
            writer.uint32(16).bool(message.GroupIDHasChanged);
        }
        if (message.NameHasChanged === true) {
            writer.uint32(24).bool(message.NameHasChanged);
        }
        if (message.UsernameHasChanged === true) {
            writer.uint32(32).bool(message.UsernameHasChanged);
        }
        if (message.PasswordHasChanged === true) {
            writer.uint32(40).bool(message.PasswordHasChanged);
        }
        if (message.TOTPHasChanged === true) {
            writer.uint32(48).bool(message.TOTPHasChanged);
        }
        if (message.TagsHasChanged === true) {
            writer.uint32(56).bool(message.TagsHasChanged);
        }
        if (message.URLHasChanged === true) {
            writer.uint32(64).bool(message.URLHasChanged);
        }
        if (message.NotesHasChanged === true) {
            writer.uint32(72).bool(message.NotesHasChanged);
        }
        if (message.DateCreatedHasChanged === true) {
            writer.uint32(80).bool(message.DateCreatedHasChanged);
        }
        if (message.DateModifiedHasChanged === true) {
            writer.uint32(88).bool(message.DateModifiedHasChanged);
        }
        if (message.DatePasswordChangedHasChanged === true) {
            writer.uint32(96).bool(message.DatePasswordChangedHasChanged);
        }
        if (message.CustomFieldsHasChanged === true) {
            writer.uint32(104).bool(message.CustomFieldsHasChanged);
        }
        return writer;
    },

    decode(
        input: _m0.Reader | Uint8Array,
        length?: number,
    ): PartialCredentialChanges {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBasePartialCredentialChanges();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.TypeHasChanged = reader.bool();
                    continue;
                case 2:
                    if (tag !== 16) {
                        break;
                    }

                    message.GroupIDHasChanged = reader.bool();
                    continue;
                case 3:
                    if (tag !== 24) {
                        break;
                    }

                    message.NameHasChanged = reader.bool();
                    continue;
                case 4:
                    if (tag !== 32) {
                        break;
                    }

                    message.UsernameHasChanged = reader.bool();
                    continue;
                case 5:
                    if (tag !== 40) {
                        break;
                    }

                    message.PasswordHasChanged = reader.bool();
                    continue;
                case 6:
                    if (tag !== 48) {
                        break;
                    }

                    message.TOTPHasChanged = reader.bool();
                    continue;
                case 7:
                    if (tag !== 56) {
                        break;
                    }

                    message.TagsHasChanged = reader.bool();
                    continue;
                case 8:
                    if (tag !== 64) {
                        break;
                    }

                    message.URLHasChanged = reader.bool();
                    continue;
                case 9:
                    if (tag !== 72) {
                        break;
                    }

                    message.NotesHasChanged = reader.bool();
                    continue;
                case 10:
                    if (tag !== 80) {
                        break;
                    }

                    message.DateCreatedHasChanged = reader.bool();
                    continue;
                case 11:
                    if (tag !== 88) {
                        break;
                    }

                    message.DateModifiedHasChanged = reader.bool();
                    continue;
                case 12:
                    if (tag !== 96) {
                        break;
                    }

                    message.DatePasswordChangedHasChanged = reader.bool();
                    continue;
                case 13:
                    if (tag !== 104) {
                        break;
                    }

                    message.CustomFieldsHasChanged = reader.bool();
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<PartialCredentialChanges>, I>>(
        base?: I,
    ): PartialCredentialChanges {
        return PartialCredentialChanges.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<PartialCredentialChanges>, I>>(
        object: I,
    ): PartialCredentialChanges {
        const message = createBasePartialCredentialChanges();
        message.TypeHasChanged = object.TypeHasChanged ?? false;
        message.GroupIDHasChanged = object.GroupIDHasChanged ?? false;
        message.NameHasChanged = object.NameHasChanged ?? false;
        message.UsernameHasChanged = object.UsernameHasChanged ?? false;
        message.PasswordHasChanged = object.PasswordHasChanged ?? false;
        message.TOTPHasChanged = object.TOTPHasChanged ?? false;
        message.TagsHasChanged = object.TagsHasChanged ?? false;
        message.URLHasChanged = object.URLHasChanged ?? false;
        message.NotesHasChanged = object.NotesHasChanged ?? false;
        message.DateCreatedHasChanged = object.DateCreatedHasChanged ?? false;
        message.DateModifiedHasChanged = object.DateModifiedHasChanged ?? false;
        message.DatePasswordChangedHasChanged =
            object.DatePasswordChangedHasChanged ?? false;
        message.CustomFieldsHasChanged = object.CustomFieldsHasChanged ?? false;
        return message;
    },
};

function createBaseTOTP(): TOTP {
    return { Label: "", Secret: "", Period: 0, Digits: 0, Algorithm: 0 };
}

export const TOTP = {
    encode(
        message: TOTP,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Label !== "") {
            writer.uint32(10).string(message.Label);
        }
        if (message.Secret !== "") {
            writer.uint32(26).string(message.Secret);
        }
        if (message.Period !== 0) {
            writer.uint32(32).int32(message.Period);
        }
        if (message.Digits !== 0) {
            writer.uint32(40).int32(message.Digits);
        }
        if (message.Algorithm !== 0) {
            writer.uint32(48).int32(message.Algorithm);
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): TOTP {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseTOTP();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.Label = reader.string();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.Secret = reader.string();
                    continue;
                case 4:
                    if (tag !== 32) {
                        break;
                    }

                    message.Period = reader.int32();
                    continue;
                case 5:
                    if (tag !== 40) {
                        break;
                    }

                    message.Digits = reader.int32();
                    continue;
                case 6:
                    if (tag !== 48) {
                        break;
                    }

                    message.Algorithm = reader.int32() as any;
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<TOTP>, I>>(base?: I): TOTP {
        return TOTP.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<TOTP>, I>>(object: I): TOTP {
        const message = createBaseTOTP();
        message.Label = object.Label ?? "";
        message.Secret = object.Secret ?? "";
        message.Period = object.Period ?? 0;
        message.Digits = object.Digits ?? 0;
        message.Algorithm = object.Algorithm ?? 0;
        return message;
    },
};

function createBaseDiff(): Diff {
    return { Hash: "" };
}

export const Diff = {
    encode(
        message: Diff,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Hash !== "") {
            writer.uint32(10).string(message.Hash);
        }
        if (message.Changes !== undefined) {
            DiffChange.encode(
                message.Changes,
                writer.uint32(18).fork(),
            ).ldelim();
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): Diff {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseDiff();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 10) {
                        break;
                    }

                    message.Hash = reader.string();
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.Changes = DiffChange.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<Diff>, I>>(base?: I): Diff {
        return Diff.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<Diff>, I>>(object: I): Diff {
        const message = createBaseDiff();
        message.Hash = object.Hash ?? "";
        message.Changes =
            object.Changes !== undefined && object.Changes !== null
                ? DiffChange.fromPartial(object.Changes)
                : undefined;
        return message;
    },
};

function createBaseDiffChange(): DiffChange {
    return { Type: 0, ID: "" };
}

export const DiffChange = {
    encode(
        message: DiffChange,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Type !== 0) {
            writer.uint32(8).int32(message.Type);
        }
        if (message.ID !== "") {
            writer.uint32(18).string(message.ID);
        }
        if (message.Props !== undefined) {
            PartialCredential.encode(
                message.Props,
                writer.uint32(26).fork(),
            ).ldelim();
        }
        return writer;
    },

    decode(input: _m0.Reader | Uint8Array, length?: number): DiffChange {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseDiffChange();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.Type = reader.int32() as any;
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.ID = reader.string();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.Props = PartialCredential.decode(
                        reader,
                        reader.uint32(),
                    );
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<DiffChange>, I>>(base?: I): DiffChange {
        return DiffChange.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<DiffChange>, I>>(
        object: I,
    ): DiffChange {
        const message = createBaseDiffChange();
        message.Type = object.Type ?? 0;
        message.ID = object.ID ?? "";
        message.Props =
            object.Props !== undefined && object.Props !== null
                ? PartialCredential.fromPartial(object.Props)
                : undefined;
        return message;
    },
};

function createBaseSynchronizationMessage(): SynchronizationMessage {
    return { Command: 0, Diffs: [], LinkedDevices: [] };
}

export const SynchronizationMessage = {
    encode(
        message: SynchronizationMessage,
        writer: _m0.Writer = _m0.Writer.create(),
    ): _m0.Writer {
        if (message.Command !== 0) {
            writer.uint32(8).int32(message.Command);
        }
        if (message.Hash !== undefined) {
            writer.uint32(18).string(message.Hash);
        }
        if (message.DivergenceHash !== undefined) {
            writer.uint32(26).string(message.DivergenceHash);
        }
        for (const v of message.Diffs) {
            Diff.encode(v!, writer.uint32(34).fork()).ldelim();
        }
        for (const v of message.LinkedDevices) {
            LinkedDevice.encode(v!, writer.uint32(42).fork()).ldelim();
        }
        return writer;
    },

    decode(
        input: _m0.Reader | Uint8Array,
        length?: number,
    ): SynchronizationMessage {
        const reader =
            input instanceof _m0.Reader ? input : _m0.Reader.create(input);
        let end = length === undefined ? reader.len : reader.pos + length;
        const message = createBaseSynchronizationMessage();
        while (reader.pos < end) {
            const tag = reader.uint32();
            switch (tag >>> 3) {
                case 1:
                    if (tag !== 8) {
                        break;
                    }

                    message.Command = reader.int32() as any;
                    continue;
                case 2:
                    if (tag !== 18) {
                        break;
                    }

                    message.Hash = reader.string();
                    continue;
                case 3:
                    if (tag !== 26) {
                        break;
                    }

                    message.DivergenceHash = reader.string();
                    continue;
                case 4:
                    if (tag !== 34) {
                        break;
                    }

                    message.Diffs.push(Diff.decode(reader, reader.uint32()));
                    continue;
                case 5:
                    if (tag !== 42) {
                        break;
                    }

                    message.LinkedDevices.push(
                        LinkedDevice.decode(reader, reader.uint32()),
                    );
                    continue;
            }
            if ((tag & 7) === 4 || tag === 0) {
                break;
            }
            reader.skipType(tag & 7);
        }
        return message;
    },

    create<I extends Exact<DeepPartial<SynchronizationMessage>, I>>(
        base?: I,
    ): SynchronizationMessage {
        return SynchronizationMessage.fromPartial(base ?? ({} as any));
    },
    fromPartial<I extends Exact<DeepPartial<SynchronizationMessage>, I>>(
        object: I,
    ): SynchronizationMessage {
        const message = createBaseSynchronizationMessage();
        message.Command = object.Command ?? 0;
        message.Hash = object.Hash ?? undefined;
        message.DivergenceHash = object.DivergenceHash ?? undefined;
        message.Diffs = object.Diffs?.map((e) => Diff.fromPartial(e)) || [];
        message.LinkedDevices =
            object.LinkedDevices?.map((e) => LinkedDevice.fromPartial(e)) || [];
        return message;
    },
};

type Builtin =
    | Date
    | Function
    | Uint8Array
    | string
    | number
    | boolean
    | undefined;

export type DeepPartial<T> = T extends Builtin
    ? T
    : T extends globalThis.Array<infer U>
    ? globalThis.Array<DeepPartial<U>>
    : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : T extends { $case: string }
    ? { [K in keyof Omit<T, "$case">]?: DeepPartial<T[K]> } & {
          $case: T["$case"];
      }
    : T extends {}
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin
    ? P
    : P & { [K in keyof P]: Exact<P[K], I[K]> } & {
          [K in Exclude<keyof I, KeysOfUnion<P>>]: never;
      };

function longToNumber(long: Long): number {
    if (long.gt(globalThis.Number.MAX_SAFE_INTEGER)) {
        throw new globalThis.Error(
            "Value is larger than Number.MAX_SAFE_INTEGER",
        );
    }
    return long.toNumber();
}

if (_m0.util.Long !== Long) {
    _m0.util.Long = Long as any;
    _m0.configure();
}
