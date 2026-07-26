import { err, ok } from "neverthrow";
import * as OTPAuth from "otpauth";
import { ulid } from "ulidx";
import { z } from "zod";

import {
    ONLINE_SERVICES_SELECTION_ID,
    REQUIRED_FIELD_ERROR,
    TOTPConstants,
} from "../consts";
import * as VaultUtilTypes from "../proto/vault";
import {
    DirectorySchema,
    DirectorySchemaType,
    TOTPFormSchema,
    TOTPFormSchemaType,
} from "./form-schemas";

export class Vault implements VaultUtilTypes.Vault {
    /*
     * NOTE: This property is **not** serialized and saved in the vault
     */
    private LATEST_VERSION = 4;

    public Version: number;
    public CurrentVersion = 0;
    public LinkedDevices: LinkedDevices;
    /** Server auth material (device signing key JWKs, user id) - separate from device sync */
    public OnlineServices?: OnlineServices;
    public Directories: Directory[] = [];
    public Credentials: VaultCredential[];

    constructor(seedData = false, seedCount = 0) {
        this.Version = this.LATEST_VERSION;

        this.LinkedDevices = new LinkedDevices();
        this.Credentials = seedData ? this.seedVault(seedCount) : [];
    }

    /**
     * Upgrades the vault to the latest version. Makes changes to the vault in place - if the vault is not in the latest version, it will be upgraded.
     * @param oldVersion - The version of the vault to upgrade from. Usually the value of the CurrentVersion property but from the clean-deserialized vault.
     */
    public async upgrade(): Promise<void> {
        // NOTE: Only CurrentVersion changes during upgrades, Version stays the same as it was when the vault was created
        /**
         * Version 2
         *  - Upgrade reasons:
         *      - Introduced new schema for Diff objects, revamped the way diffs are stored
         *  - Other bigger changes (no upgrade needed):
         *      - Changed the backup output to be more compact (binary instead of B64 data encoded in a JSON blob)
         *      - Changed the way the synchronization messsages are serialized and deserialized (to be more compact and efficient)
         */
        // NOTE: Check for the current version first, then for the version at vault creation (so we don't trigger on vault create)
        if (this.CurrentVersion < 2 && this.Version < 2) {
            console.warn(
                `Upgrading Vault object to version 2 (from version ${this.CurrentVersion})...`,
            );
            // Clear the list of diffs
            // this.Diffs = [];

            // Set the current version to 2
            this.CurrentVersion = 2;

            console.warn("Upgraded Vault object to version 2.");
        }

        /**
         * Version 3
         *  - Upgrade reasons:
         *      - Introduced new schema for VersionVector objects, revamped the way version vectors are stored
         *      - Deprecated the DateCreated, DateModified and DatePasswordChanged properties
         *      - Added new properties for the dates to store the Unix timestamps instead of ISO strings
         */
        if (this.CurrentVersion < 3 && this.Version < 3) {
            console.warn(
                `Upgrading Vault object to version 3 (from version ${this.CurrentVersion})...`,
            );

            // Make sure that the DateCreated, DateModified and DatePasswordChanged properties are converted to Unix timestamps
            // and saved to the DateCreatedTimestamp, DateModifiedTimestamp and DatePasswordChangedTimestamp properties
            this.Credentials.forEach((cred) => {
                cred.DateCreatedTimestamp = new Date(
                    cred.DateCreated,
                ).getTime();
                cred.DateModifiedTimestamp = cred.DateModified
                    ? new Date(cred.DateModified).getTime()
                    : cred.DateCreatedTimestamp;
                cred.DatePasswordChangedTimestamp = cred.DatePasswordChanged
                    ? new Date(cred.DatePasswordChanged).getTime()
                    : cred.DateCreatedTimestamp;
            });

            // Set the current version to 3
            this.CurrentVersion = 3;

            console.warn("Upgraded Vault object to version 3.");
        }

        /**
         * Version 4
         *  - Replaces the unused Group wire fields with flat, synchronized
         *    directories. Existing group assignments intentionally become Root.
         */
        if (this.CurrentVersion < 4 && this.Version < 4) {
            console.warn(
                `Upgrading Vault object to version 4 (from version ${this.CurrentVersion})...`,
            );

            this.Directories = [];
            await Promise.all(
                this.Credentials.map(async (credential) => {
                    credential.DirectoryID = "";
                    credential.Hash = await hashCredential(credential);
                }),
            );
            this.CurrentVersion = 4;

            console.warn("Upgraded Vault object to version 4.");
        }
    }

    /**
     * Seeds the vault with mock credentials
     * @param num - Number of credentials to seed the vault with
     * @returns An array of mock credentials
     */
    private seedVault(num: number): VaultCredential[] {
        const creds: VaultCredential[] = [];

        // Generate n mock credentials
        for (let i = 0; i < num; i++) {
            const newCreds = new VaultCredential();
            newCreds.ID = `TestCreds-${i}`;
            newCreds.Name = `Test Credential ${i}`;
            newCreds.Username = `Test Username ${i}`;
            newCreds.Password = `Test Password ${i}`;
            creds.push(newCreds);
        }

        return creds;
    }

    public static bindOnlineServices(
        vault: Vault,
        onlineServices: OnlineServices,
    ): void {
        vault.OnlineServices = onlineServices;
    }

    public static unbindOnlineServices(vault: Vault): void {
        vault.OnlineServices = undefined;
    }

    public static isOnlineServicesBound(
        vault: Vault,
    ): vault is Vault & { OnlineServices: OnlineServices } {
        return vault.OnlineServices !== undefined;
    }
}

export class LinkedDevice implements VaultUtilTypes.LinkedDevice {
    public ID: string;
    public Name: string;
    public SyncID: string;
    public LastSync: string | undefined;
    public LinkedAtTimestamp = Date.now();
    public AutoConnect: boolean;
    public AutoSync: boolean;
    public SyncTimeout: boolean;
    public SyncTimeoutPeriod: number;
    public STUNServerIDs: string[] = [];
    public TURNServerIDs: string[] = [];
    public SignalingServerID = ONLINE_SERVICES_SELECTION_ID;
    public RemoteSyncPublicKey = "";
    public RemoteSyncKemPublicKey = "";

    constructor(
        deviceName: string,
        syncID: string,
        remoteSyncPublicKey: string,
        remoteSyncKemPublicKey: string,
        linkedAtTimestamp = Date.now(),
        autoConnect = true,
        syncTimeout = false,
        syncTimeoutPeriod = 30,
        stunServerIDs: string[] = [],
        turnServerIDs: string[] = [],
        signalingServerID = ONLINE_SERVICES_SELECTION_ID,
        autoSync = true,
    ) {
        this.ID = ulid();
        this.Name = deviceName;
        this.SyncID = syncID;
        this.RemoteSyncPublicKey = remoteSyncPublicKey;
        this.RemoteSyncKemPublicKey = remoteSyncKemPublicKey;
        this.LinkedAtTimestamp = linkedAtTimestamp;
        this.AutoConnect = autoConnect;
        this.AutoSync = autoSync;
        this.SyncTimeout = syncTimeout;
        this.SyncTimeoutPeriod = syncTimeoutPeriod;
        this.STUNServerIDs = stunServerIDs;
        this.TURNServerIDs = turnServerIDs;
        this.SignalingServerID = signalingServerID;
    }
}

export class STUNServerConfiguration
    implements VaultUtilTypes.STUNServerConfiguration
{
    Version: number = 1;

    ID: string;
    Name: string;
    Host: string;

    constructor(name = "", host = "") {
        this.ID = ulid();
        this.Name = name;
        this.Host = host;
    }
}

export class TURNServerConfiguration
    implements VaultUtilTypes.TURNServerConfiguration
{
    Version: number = 1;

    ID: string;
    Name: string;
    Host: string;
    Username: string;
    Password: string;

    constructor(name = "", host = "", username = "", password = "") {
        this.ID = ulid();
        this.Name = name;
        this.Host = host;
        this.Username = username;
        this.Password = password;
    }
}

export class SignalingServerConfiguration
    implements VaultUtilTypes.SignalingServerConfiguration
{
    Version: number = 1;

    ID: string;
    Name: string;
    AppID: string;
    Key: string;
    Secret: string;
    Host: string;
    ServicePort: string;
    SecureServicePort: string;

    constructor(
        name = "",
        appID = "",
        key = "",
        secret = "",
        host = "",
        servicePort = "",
        secureServicePort = "",
    ) {
        this.ID = ulid();
        this.Name = name;
        this.AppID = appID;
        this.Key = key;
        this.Secret = secret;
        this.Host = host;
        this.ServicePort = servicePort;
        this.SecureServicePort = secureServicePort;
    }
}

export class LinkedDevices implements VaultUtilTypes.LinkedDevices {
    public Devices: LinkedDevice[] = [];

    public STUNServers: STUNServerConfiguration[] = [];
    public TURNServers: TURNServerConfiguration[] = [];
    public SignalingServers: SignalingServerConfiguration[] = [];
    public SyncSigningPublicKey = "";
    public SyncSigningPrivateKey = "";
    public SyncKemPublicKey = "";
    public SyncKemPrivateKey = "";

    public static fromGeneric(rawOnlineServices: VaultUtilTypes.LinkedDevices) {
        // TODO: Remove this
        const newInstance = Object.assign(
            new LinkedDevices(),
            rawOnlineServices,
        );

        newInstance.Devices = rawOnlineServices.Devices.map((ld) =>
            LinkedDevices.fromGenericDevice(ld),
        );

        return newInstance;
    }

    public static fromGenericDevice(
        rawDevice: VaultUtilTypes.LinkedDevice,
    ): LinkedDevice {
        return Object.assign(
            Object.create(LinkedDevice.prototype) as LinkedDevice,
            {
                RemoteSyncPublicKey: "",
                RemoteSyncKemPublicKey: "",
            },
            rawDevice,
        );
    }

    public static addLinkedDevice(
        instance: LinkedDevices,
        deviceName: string,
        syncID: string,
        remoteSyncPublicKey: string,
        remoteSyncKemPublicKey: string,
        stunServerIDs: string[] = [],
        turnServerIDs: string[] = [],
        signalingServerID: string = ONLINE_SERVICES_SELECTION_ID,
        linkedAtTimestamp = Date.now(),
        autoConnect?: boolean,
        syncTimeout?: boolean,
        syncTimeoutPeriod?: number,
        autoSync?: boolean,
    ): LinkedDevice {
        const device = new LinkedDevice(
            deviceName,
            syncID,
            remoteSyncPublicKey,
            remoteSyncKemPublicKey,
            linkedAtTimestamp,
            autoConnect,
            syncTimeout,
            syncTimeoutPeriod,
            stunServerIDs,
            turnServerIDs,
            signalingServerID ?? ONLINE_SERVICES_SELECTION_ID,
            autoSync,
        );
        instance.Devices.push(device);
        return device;
    }

    public static removeLinkedDevice(
        list: LinkedDevice[],
        deviceID: string,
    ): LinkedDevice[] {
        return list.filter((device) => device.ID !== deviceID);
    }

    public static isUsingOnlineServices(device: LinkedDevice): boolean {
        return (
            device.STUNServerIDs.length === 0 ||
            device.TURNServerIDs.length === 0 ||
            device.SignalingServerID === ONLINE_SERVICES_SELECTION_ID
        );
    }
}

/**
 * Cryptex Vault Online Services - authentication material stored in the encrypted vault.
 */
export class OnlineServices implements VaultUtilTypes.OnlineServices {
    public DeviceId: string;
    public UserID: string;
    public PrivateKeyJWK: string;
    public PublicKeyJWK: string;
    /** Cached server root status for this device; see `syncOnlineServicesRemoteConfiguration`. */
    public IsRootDevice: boolean = false;

    constructor(
        deviceId: string,
        userId: string,
        publicKeyJWK: string,
        privateKeyJWK: string,
        isRootDevice: boolean = false,
    ) {
        this.DeviceId = deviceId;
        this.UserID = userId;
        this.PublicKeyJWK = publicKeyJWK;
        this.PrivateKeyJWK = privateKeyJWK;
        this.IsRootDevice = isRootDevice;
    }
}

export class Directory
    implements VaultUtilTypes.Directory, DirectorySchemaType
{
    public ID: string;
    public Name: string;
    public Version: number;
    public Hash: string;
    public DateModifiedTimestamp: number;
    public Deleted: boolean;

    constructor(name = "") {
        this.ID = ulid();
        this.Name = name.trim();
        this.Version = 0;
        this.Hash = "";
        this.DateModifiedTimestamp = Date.now();
        this.Deleted = false;
    }
}

export class TOTP implements VaultUtilTypes.TOTP, TOTPFormSchemaType {
    public Label: string;
    public Secret: string;
    public Period: number;
    public Digits: number;
    public Algorithm: VaultUtilTypes.TOTPAlgorithm;

    constructor() {
        this.Label = "";
        this.Secret = "";
        this.Period = TOTPConstants.PERIOD_DEFAULT;
        this.Digits = TOTPConstants.DIGITS_DEFAULT;
        this.Algorithm = TOTPConstants.ALGORITHM_DEFAULT;
    }
}

export const calculateTOTP = (
    data: TOTP,
): {
    code: string;
    timeRemaining: number;
} => {
    const code = OTPAuth.TOTP.generate({
        secret: OTPAuth.Secret.fromBase32(data.Secret),
        algorithm: VaultUtilTypes.TOTPAlgorithm[data.Algorithm],
        digits: data.Digits,
        period: data.Period,
    });

    const timeRemaining = data.Period - (new Date().getSeconds() % data.Period);

    return {
        code,
        timeRemaining,
    };
};

export class CustomField implements VaultUtilTypes.CustomField {
    public ID: string;
    public Name: string;
    public Type: VaultUtilTypes.CustomFieldType;
    public Value: string;

    constructor() {
        this.ID = "-1";
        this.Name = "";
        this.Type = VaultUtilTypes.CustomFieldType.Text;
        this.Value = "";
    }
}

export const CredentialFormSchema = z.object({
    ID: z.string().nullable(),
    Type: z.nativeEnum(VaultUtilTypes.ItemType),
    DirectoryID: z.string(),
    Name: z.string().min(1, REQUIRED_FIELD_ERROR).max(255, "Name is too long"),
    Username: z.string(),
    Password: z.string(),
    TOTP: TOTPFormSchema.optional().nullable(), // This has to be nullable because of the way the form works
    Tags: z.string().optional(),
    URL: z.string(),
    Notes: z.string(),
    // DateCreated: z.string().optional(), // Used only in diffing
    // DateModified: z.string().optional(), // Used only in diffing
    // DatePasswordChanged: z.string().optional(), // Used only in diffing
    CustomFields: z.array(
        z.object({
            ID: z.string(),
            Name: z.string(),
            Type: z.nativeEnum(VaultUtilTypes.CustomFieldType),
            Value: z.string(),
        }),
    ),
});
export type CredentialFormSchemaType = z.infer<typeof CredentialFormSchema>;
export class VaultCredential
    implements VaultUtilTypes.Credential, CredentialFormSchemaType
{
    public ID: string;
    public Type: VaultUtilTypes.ItemType;
    public DirectoryID: string;
    public Name: string;
    public Username: string;
    public Password: string;
    public TOTP?: TOTP | undefined;
    public Tags?: string | undefined;
    public URL: string;
    public Notes: string;

    /**
     * NOTE: These fields are deprecated and can be removed after August 2026
     * @deprecated
     */
    public DateCreated: string = new Date().toISOString();
    /** @deprecated */
    public DateModified?: string | undefined;
    /** @deprecated */
    public DatePasswordChanged?: string | undefined;

    public CustomFields: CustomField[];
    public Hash: string;
    public Version: number;
    public DateCreatedTimestamp: number;
    public DateModifiedTimestamp: number;
    public DatePasswordChangedTimestamp: number;
    public Deleted = false;

    constructor(form?: CredentialFormSchemaType) {
        this.ID = form?.ID ? String(form.ID).trim() : ulid();

        this.Type = form?.Type ?? VaultUtilTypes.ItemType.Credentials;
        this.DirectoryID = form?.DirectoryID
            ? String(form.DirectoryID).trim()
            : "";

        this.Name = form?.Name ? String(form.Name).trim() : "Unnamed item";
        this.Username = form?.Username ? String(form.Username).trim() : "";
        this.Password = form?.Password ? String(form.Password) : "";
        // TODO: Remove this object assignment
        this.TOTP = form?.TOTP
            ? Object.assign(new TOTP(), form.TOTP)
            : undefined;
        this.Tags = form?.Tags ? String(form.Tags).trim() : "";
        this.URL = form?.URL ? String(form.URL).trim() : "";
        this.Notes = form?.Notes ? String(form.Notes).trim() : "";

        // The version is 0 for new credentials. This is to be incremented when the credential is modified.
        this.Version = 0;

        this.DateCreatedTimestamp = Date.now();
        this.DateModifiedTimestamp = Date.now();
        this.DatePasswordChangedTimestamp = Date.now();

        this.CustomFields = form?.CustomFields ?? [];
        this.Hash = "";

        this.Deleted = false;
    }
}

/**
 * Assimilates an imported credential into the vault.
 * This is done by creating a new credential object with the same data as the imported one, but with a new ID.
 * The new ID is generated using the same logic as the rest of the vault.
 * The hash of the credential is recalculated to ensure that the credential is valid.
 * @param credential The imported credential to assimilate
 * @returns The assimilated credential
 */
export const assimilateImportedCredential = async (
    credential: VaultUtilTypes.Credential,
) => {
    let newCredential = new VaultCredential();

    // Save the new credential's ID before we overwrite it with the imported one
    const generatedID = newCredential.ID;

    newCredential = Object.assign(new VaultCredential(), credential);

    // Restore the new credential's ID
    newCredential.ID = generatedID;

    // Recalculate the hash of the credential
    newCredential.Hash = await hashCredential(newCredential);

    return newCredential;
};

const prepareCredentialForHashing = (credential: VaultCredential) => {
    // NOTE: When adding new fields, make sure to add them to the includedFields array
    // The excluded fields are also listed here (commented out) for reference
    const includedFields: (keyof VaultCredential)[] = [
        "ID",
        "Type",
        "DirectoryID",
        "Name",
        "Username",
        "Password",
        // "TOTP",
        "Tags",
        "URL",
        "Notes",
        "DateCreated",
        "DateModified",
        "DatePasswordChanged",
        // "CustomFields",
        "Deleted",
        // "Hash",
    ];

    // These are the fields we don't want to blindly concatenate, so we exclude them and handle them separately (if needed)
    const excludedFields: (keyof VaultCredential)[] = [
        "TOTP",
        "CustomFields",
        "Hash",
    ];

    let concatenatedValues = "";

    includedFields.forEach((key) => {
        // NOTE: Ran some performance test on this check; it's faster than actually checking
        //  if the key is of the value we're looking for
        if (!excludedFields.includes(key)) {
            // Concatenate the value of the field to the string
            const value = credential[key];
            concatenatedValues +=
                value == null || typeof value !== "object"
                    ? String(value ?? "")
                    : JSON.stringify(value);
        }
    });

    concatenatedValues += credential.CustomFields.map((field) => {
        return String(field.Name) + String(field.Value) + String(field.Type);
    }).join("|");

    // Handle the TOTP field separately
    concatenatedValues += String(credential.TOTP?.Label ?? "");
    concatenatedValues += String(credential.TOTP?.Algorithm ?? "");
    concatenatedValues += String(credential.TOTP?.Digits ?? "");
    concatenatedValues += String(credential.TOTP?.Period ?? "");
    concatenatedValues += credential.TOTP?.Secret ?? "";

    return concatenatedValues;
};

/**
 * Calculates the hash of the credential and returns it.
 * @returns The hash of the credential
 */
export const hashCredential = async (credential: VaultCredential) => {
    const data = prepareCredentialForHashing(credential);

    const hash = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(data),
    );

    const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return hashHex;
};

/**
 * Returns the sorted list of credentials in the vault.
 * The credentials are sorted by ID (ULID) in lexicographic order.
 * @param credentials - The list of credentials to sort
 * @returns The sorted list of credentials
 */
const getSortedCredentials = (
    credentials: VaultCredential[],
): VaultCredential[] => {
    return credentials.sort((a, b) => a.ID.localeCompare(b.ID));
};

/**
 * Hashes the vault's credentials and returns the hash as a hex string.
 * It also sorts the credentials to ensure that the hash is consistent - by using ULIDs.
 * Each credential is hashed individually, and the hashes are concatenated and hashed again.
 * @remarks The hash is generated using the SHA-1 algorithm.
 * @remarks If there are no credentials, an empty string will get hashed. Which will result in the following hash: da39a3ee5e6b4b0d3255bfef95601890afd80709
 * @returns A hash in the form of a hex string
 */
export const hashCredentials = async (
    credentials: VaultCredential[],
): Promise<string> => {
    // Credentials sorted by ID (ULIDs) by lexicographic order
    const sortedCreds = getSortedCredentials(credentials);

    let concatedHashes = "";
    for (const cred of sortedCreds) {
        concatedHashes += await hashCredential(cred);
    }

    // Generate a hash of the credentials hashes
    const credentialsHash = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(concatedHashes),
    );

    // Return the hash as a hex string
    return Array.from(new Uint8Array(credentialsHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
};

//#region Credential Methods
/**
 * Creates a credential from the given data.
 * @remarks You might want to create a diff after creating a credential, but this is not necessary.
 * @param data The form data with which to create the credential.
 * - The data can come from the frontend (CredentialFormSchemaType) or from a diff (PartialCredential) we're applying.
 * @returns The new credential and the changes that were made to it
 */
export const createCredential = async (data: CredentialFormSchemaType) => {
    const newCreds = new VaultCredential(data);

    newCreds.Hash = await hashCredential(newCreds);

    return newCreds;
};

export const updateCredentialFromForm = async (
    existingCredential: VaultCredential,
    form: CredentialFormSchemaType,
) => {
    // const modedCredential = updateCredential(existingCredential, form);
    const moddedCredential = Object.assign(
        new VaultCredential(),
        existingCredential,
    );

    const today = Date.now();

    // The ID cannot be changed, so we don't check for it
    // this.ID = form.ID ?? this.ID;

    moddedCredential.Type = form.Type ?? existingCredential.Type;
    moddedCredential.DirectoryID =
        form.DirectoryID ?? existingCredential.DirectoryID;

    moddedCredential.Name = form.Name ?? existingCredential.Name;
    moddedCredential.Username = form.Username ?? existingCredential.Username;

    // Only update the DatePasswordChanged if the password has changed
    // existingCredential only takes a non nullish value of the password into account
    if (
        moddedCredential.Password !==
        (form.Password ?? existingCredential.Password)
    ) {
        moddedCredential.Password =
            form.Password ?? existingCredential.Password;
        moddedCredential.DatePasswordChangedTimestamp = today;
    }

    moddedCredential.TOTP = form.TOTP
        ? Object.assign(new TOTP(), form.TOTP)
        : undefined;
    moddedCredential.Tags = form.Tags ?? moddedCredential.Tags;
    moddedCredential.URL = form.URL ?? moddedCredential.URL;
    moddedCredential.Notes = form.Notes ?? moddedCredential.Notes;

    // The date created cannot be changed, so we don't check for it
    // existingCredential.DateCreated = form.DateCreated ?? existingCredential.DateCreated;

    moddedCredential.DateModifiedTimestamp = today;

    moddedCredential.CustomFields =
        form.CustomFields ?? moddedCredential.CustomFields;

    // Bump the version of the credential since we're handling a modification
    moddedCredential.Version = moddedCredential.Version + 1;

    // Recalculate the hash, since the credential has been updated
    moddedCredential.Hash = await hashCredential(moddedCredential);

    return moddedCredential;
};

/**
 * Mutates the given list of credentials by replacing the credential with the given ID with a new one that has the tombstone flag set to true.
 * The new credential object is created with the same ID, but with the tombstone flag set to true and the date modified timestamp set to the current time.
 * All other fields are cleaned up to remove any sensitive data.
 * @param credentialsList The list of credentials to mark the credential as deleted and replace with a de-sensitized one
 * @param id The ID of the credential to mark as deleted
 * @returns The list of credentials after the credential was marked as deleted and replaced with a de-sensitized one
 */
export const deleteCredential = async (
    credentialsList: VaultCredential[],
    id: string,
) => {
    const index = credentialsList.findIndex((c) => c.ID === id);
    const credential = credentialsList[index];

    // If we didn't find the credential, return an error
    if (!credential) return err("Credential not found");

    // Set the tombstone flag to true and clean up the credential to remove any sensitive data
    const cleanCredential = new VaultCredential();
    cleanCredential.ID = credential.ID;
    cleanCredential.Deleted = true;

    cleanCredential.DateCreatedTimestamp = credential.DateCreatedTimestamp;
    cleanCredential.DateModifiedTimestamp = Date.now();

    // Bump the version of the credential since we're handling a modification (tombstone flag is considered a modification)
    cleanCredential.Version = credential.Version + 1;

    cleanCredential.Hash = await hashCredential(cleanCredential);

    // Replace the credential with the clean one
    credentialsList.splice(index, 1, cleanCredential);

    return ok(credentialsList);
};
//#endregion Credential Methods

//#region Directory Methods
export const normalizeDirectoryName = (name: string): string =>
    name.trim().toLowerCase();

const digestHex = async (value: string): Promise<string> => {
    const hash = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

export const hashDirectory = async (
    directory: Pick<Directory, "ID" | "Name" | "Deleted">,
): Promise<string> =>
    digestHex(
        [directory.ID, directory.Name, String(directory.Deleted)].join(
            "\u0000",
        ),
    );

export const sortDirectories = (directories: Directory[]): Directory[] =>
    [...directories]
        .filter((directory) => !directory.Deleted)
        .sort(
            (a, b) =>
                a.Name.localeCompare(b.Name, undefined, {
                    sensitivity: "base",
                }) || a.ID.localeCompare(b.ID),
        );

export const shouldAcceptVersionedRecord = (
    local:
        | Pick<Directory, "Version" | "DateModifiedTimestamp" | "Hash">
        | undefined,
    incoming: Pick<Directory, "Version" | "DateModifiedTimestamp" | "Hash">,
): boolean => {
    if (!local) return true;
    if (incoming.Version !== local.Version) {
        return incoming.Version > local.Version;
    }
    if (incoming.DateModifiedTimestamp !== local.DateModifiedTimestamp) {
        return incoming.DateModifiedTimestamp > local.DateModifiedTimestamp;
    }
    return incoming.Hash < local.Hash;
};

export const validateDirectoryName = (
    directories: Pick<Directory, "ID" | "Name" | "Deleted">[],
    name: string,
    excludeID?: string,
): string => {
    const result = DirectorySchema.shape.Name.safeParse(name);
    if (!result.success) {
        throw new Error(
            result.error.issues[0]?.message ?? "Invalid directory name",
        );
    }
    const parsed = result.data;
    const normalized = normalizeDirectoryName(parsed);
    if (
        directories.some(
            (directory) =>
                !directory.Deleted &&
                directory.ID !== excludeID &&
                normalizeDirectoryName(directory.Name) === normalized,
        )
    ) {
        throw new Error("A directory with this name already exists");
    }
    return parsed;
};

export const createDirectory = async (
    directories: Directory[],
    form: Omit<DirectorySchemaType, "ID"> & { ID?: string | null },
): Promise<Directory> => {
    const name = validateDirectoryName(directories, form.Name);
    const directory = new Directory(name);
    directory.ID = form.ID || directory.ID;
    directory.Hash = await hashDirectory(directory);
    directories.push(directory);
    return directory;
};

export const updateDirectory = async (
    directories: Directory[],
    directoryID: string,
    form: Pick<DirectorySchemaType, "Name">,
): Promise<Directory> => {
    if (!directoryID) throw new Error("Root cannot be renamed");
    const directory = directories.find(
        (entry) => entry.ID === directoryID && !entry.Deleted,
    );
    if (!directory) throw new Error("Directory not found");

    directory.Name = validateDirectoryName(
        directories,
        form.Name,
        directory.ID,
    );
    directory.Version += 1;
    directory.DateModifiedTimestamp = Date.now();
    directory.Hash = await hashDirectory(directory);
    return directory;
};

/** Deterministically suffix duplicate synchronized names by directory ID. */
export const resolveDirectoryNameCollisions = async (
    directories: Directory[],
): Promise<void> => {
    const claimed = new Set<string>();
    const ordered = [...directories]
        .filter((directory) => !directory.Deleted)
        .sort((a, b) => a.ID.localeCompare(b.ID));

    for (const directory of ordered) {
        const base = directory.Name.trim();
        let candidate = base;
        let suffix = 2;
        while (claimed.has(normalizeDirectoryName(candidate))) {
            const suffixText = ` (${suffix++})`;
            candidate = `${base.slice(0, 100 - suffixText.length)}${suffixText}`;
        }
        claimed.add(normalizeDirectoryName(candidate));
        if (candidate !== directory.Name) {
            directory.Name = candidate;
            directory.Version += 1;
            directory.Hash = await hashDirectory(directory);
        }
    }
};

export const moveCredentialsToDirectory = async (
    credentials: VaultCredential[],
    credentialIDs: string[],
    directoryID: string,
    directories: Directory[],
): Promise<VaultCredential[]> => {
    if (
        directoryID &&
        !directories.some(
            (directory) => directory.ID === directoryID && !directory.Deleted,
        )
    ) {
        throw new Error("Directory not found");
    }

    const ids = new Set(credentialIDs);
    const now = Date.now();
    await Promise.all(
        credentials.map(async (credential) => {
            if (
                ids.has(credential.ID) &&
                !credential.Deleted &&
                credential.DirectoryID !== directoryID
            ) {
                credential.DirectoryID = directoryID;
                credential.Version += 1;
                credential.DateModifiedTimestamp = now;
                credential.Hash = await hashCredential(credential);
            }
        }),
    );
    return credentials;
};

export const deleteDirectory = async (
    directories: Directory[],
    credentials: VaultCredential[],
    directoryID: string,
): Promise<{ deletedCredentialCount: number }> => {
    if (!directoryID) throw new Error("Root cannot be deleted");
    const directory = directories.find(
        (entry) => entry.ID === directoryID && !entry.Deleted,
    );
    if (!directory) throw new Error("Directory not found");

    const now = Date.now();
    directory.Name = "";
    directory.Deleted = true;
    directory.Version += 1;
    directory.DateModifiedTimestamp = now;
    directory.Hash = await hashDirectory(directory);

    const containedCredentialIDs = credentials
        .filter(
            (credential) =>
                !credential.Deleted && credential.DirectoryID === directoryID,
        )
        .map((credential) => credential.ID);

    // deleteCredential replaces entries in the list, so delete sequentially to
    // avoid concurrent splices using indexes captured before an earlier delete.
    for (const credentialID of containedCredentialIDs) {
        const result = await deleteCredential(credentials, credentialID);
        if (result.isErr()) {
            throw new Error(result.error);
        }
    }

    return { deletedCredentialCount: containedCredentialIDs.length };
};
//#endregion Directory Methods

/**
 * Packages the vault for linking to another device.
 * Creates a copy, resets linked-device sync state, and sets OnlineServices for the peer.
 */
export const packageForLinking = (
    instance: Vault,
    syncID: string,
    stunServerIDs: string[],
    turnServerIDs: string[],
    signalingServerID: string,
    localSyncPublicKey: string,
    localSyncKemPublicKey: string,
): Vault => {
    // Create a copy of the vault so we don't modify the original
    const vaultCopy = Object.assign(new Vault(), instance);

    // Clear linked-device sync state and re-bind for the other device
    vaultCopy.LinkedDevices = new LinkedDevices();

    // Clear the Online Services configuration because this data is delivered in the original linking package
    vaultCopy.OnlineServices = undefined;

    // Copy over only the used STUN and TURN servers, and the signaling server
    vaultCopy.LinkedDevices.STUNServers =
        instance.LinkedDevices.STUNServers.filter((server) =>
            stunServerIDs.includes(server.ID),
        );
    vaultCopy.LinkedDevices.TURNServers =
        instance.LinkedDevices.TURNServers.filter((server) =>
            turnServerIDs.includes(server.ID),
        );
    vaultCopy.LinkedDevices.SignalingServers =
        instance.LinkedDevices.SignalingServers.filter(
            (server) => server.ID === signalingServerID,
        );

    // Since this device is the one linking, we can call it the root device
    const deviceName = "Root Device";

    // Plant this device as a linked device in the new vault
    LinkedDevices.addLinkedDevice(
        vaultCopy.LinkedDevices,
        deviceName,
        syncID,
        localSyncPublicKey,
        localSyncKemPublicKey,
        stunServerIDs,
        turnServerIDs,
        signalingServerID,
    );

    return vaultCopy;
};
