import { err, ok } from "neverthrow";
import * as OTPAuth from "otpauth";
import { ulid } from "ulidx";
import { z } from "zod";

import {
    ONLINE_SERVICES_SELECTION_ID,
    REQUIRED_FIELD_ERROR,
    TOTPConstants,
} from "../../utils/consts";
import * as VaultUtilTypes from "../proto/vault";
import {
    GroupSchemaType,
    TOTPFormSchema,
    TOTPFormSchemaType,
} from "./form-schemas";

export class Vault implements VaultUtilTypes.Vault {
    /*
     * NOTE: This property is **not** serialized and saved in the vault
     */
    private LATEST_VERSION = 3;

    public Version: number;
    public CurrentVersion = 0;
    public LinkedDevices: LinkedDevices;
    public Groups: Group[] = [];
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
    public upgrade(): void {
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
                cred.DateCreatedTimestamp = new Date(cred.DateCreated).getTime();
                cred.DateModifiedTimestamp = cred.DateModified ? new Date(cred.DateModified).getTime() : cred.DateCreatedTimestamp;
                cred.DatePasswordChangedTimestamp = cred.DatePasswordChanged ? new Date(cred.DatePasswordChanged).getTime() : cred.DateCreatedTimestamp;
            });

            // Set the current version to 3
            this.CurrentVersion = 3;
        
            console.warn("Upgraded Vault object to version 3.");
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
}

export class LinkedDevice implements VaultUtilTypes.LinkedDevice {
    public ID: string;
    public Name: string;
    public LastSync: string | undefined;
    public IsRoot = false;
    public LinkedAtTimestamp = Date.now();
    public AutoConnect: boolean;
    public SyncTimeout: boolean;
    public SyncTimeoutPeriod: number;

    public STUNServerIDs: string[] = [];
    public TURNServerIDs: string[] = [];
    public SignalingServerID = ONLINE_SERVICES_SELECTION_ID;

    constructor(
        deviceID = "",
        deviceName = "",
        isRoot = false,
        linkedAtTimestamp = Date.now(),
        autoConnect = true,
        syncTimeout = false,
        syncTimeoutPeriod = 30,
        stunServerIDs: string[] = [],
        turnServerIDs: string[] = [],
        signalingServerID = ONLINE_SERVICES_SELECTION_ID,
    ) {
        this.ID = deviceID;
        this.Name = deviceName;
        this.IsRoot = isRoot;
        this.LinkedAtTimestamp = linkedAtTimestamp;
        this.AutoConnect = autoConnect;
        this.SyncTimeout = syncTimeout;
        this.SyncTimeoutPeriod = syncTimeoutPeriod;
        this.STUNServerIDs = stunServerIDs;
        this.TURNServerIDs = turnServerIDs;
        this.SignalingServerID = signalingServerID;
    }

    public updateLastSync(): void {
        this.LastSync = new Date().toISOString();
    }

    public set setName(name: string) {
        if (name.trim().length > 0) {
            this.Name = name;
        }
    }

    public set setAutoConnect(autoConnect: boolean) {
        this.AutoConnect = autoConnect;
    }

    public set setSyncTimeout(syncTimeout: boolean) {
        this.SyncTimeout = syncTimeout;
    }

    public set setSyncTimeoutPeriod(syncTimeoutPeriod: number) {
        this.SyncTimeoutPeriod = Math.abs(syncTimeoutPeriod);
    }

    public set setSTUNServers(ids: string[]) {
        this.STUNServerIDs = ids;
    }

    public set setTURNServers(ids: string[]) {
        this.TURNServerIDs = ids;
    }

    public set setSignalingServer(id: string) {
        this.SignalingServerID = id;
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
    public ID: string = ulid();
    public APIKey?: string;
    public CreationTimestamp = Date.now();

    public Devices: LinkedDevice[] = [];

    public STUNServers: STUNServerConfiguration[] = [];
    public TURNServers: TURNServerConfiguration[] = [];
    public SignalingServers: SignalingServerConfiguration[] = [];

    public static fromGeneric(rawOnlineServices: VaultUtilTypes.LinkedDevices) {
        // TODO: Remove this
        const newInstance = Object.assign(
            new LinkedDevices(),
            rawOnlineServices,
        );

        newInstance.Devices = rawOnlineServices.Devices.map((ld) =>
            Object.assign(new LinkedDevice(), ld),
        );

        // TODO: Remove these
        newInstance.STUNServers = rawOnlineServices.STUNServers.map((stun) =>
            Object.assign(new STUNServerConfiguration(), stun),
        );
        newInstance.TURNServers = rawOnlineServices.TURNServers.map((turn) =>
            Object.assign(new TURNServerConfiguration(), turn),
        );
        newInstance.SignalingServers = rawOnlineServices.SignalingServers.map(
            (signaling) =>
                Object.assign(new SignalingServerConfiguration(), signaling),
        );

        return newInstance;
    }

    public static bindAccount(instance: LinkedDevices, apiKey: string): void {
        instance.ID = apiKey.slice(36);
        instance.APIKey = apiKey;
        instance.CreationTimestamp = Date.now();
    }

    public static unbindAccount(instance: LinkedDevices): void {
        // NOTE: Don't reset the ID, if there are any devices linked (not using Cryptex Vault Online Service) to this account
        // - they will be unable to sync
        // instance.ID = ulid();
        instance.APIKey = undefined;
        instance.CreationTimestamp = Date.now();

        // Remove all devices that are using the Cryptex Vault Online Services
        // instance.Devices = instance.Devices.filter(
        //     (d) =>
        //         d.STUNServerIDs.length > 0 &&
        //         d.TURNServerIDs.length > 0 &&
        //         d.SignalingServerID != ONLINE_SERVICES_SELECTION_ID,
        // );
    }

    public static isBound(instance: LinkedDevices): boolean {
        return instance.APIKey != null;
    }

    public static addLinkedDevice(
        instance: LinkedDevices,
        deviceID: string,
        deviceName: string,
        isRoot = false,
        stunServerIDs: string[] = [],
        turnServerIDs: string[] = [],
        signalingServerID: string = ONLINE_SERVICES_SELECTION_ID,
        linkedAtTimestamp = Date.now(),
        autoConnect?: boolean,
        syncTimeout?: boolean,
        syncTimeoutPeriod?: number,
    ): void {
        instance.Devices.push(
            new LinkedDevice(
                deviceID,
                deviceName,
                isRoot,
                linkedAtTimestamp,
                autoConnect,
                syncTimeout,
                syncTimeoutPeriod,
                stunServerIDs,
                turnServerIDs,
                signalingServerID ?? ONLINE_SERVICES_SELECTION_ID,
            ),
        );
    }

    public static generateNewDeviceID(): string {
        return ulid();
    }

    public static removeLinkedDevice(
        list: LinkedDevice[],
        deviceID: string,
    ): LinkedDevice[] {
        return list.filter((device) => device.ID !== deviceID);
    }
}

export class Group implements VaultUtilTypes.Group, GroupSchemaType {
    public ID: string;
    public Name: string;
    public Icon: string;
    public Color: string;

    constructor(name = "", icon = "", color = "") {
        this.ID = "-1";
        this.Name = name;
        this.Icon = icon;
        this.Color = color;
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
    GroupID: z.string(),
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
    public GroupID: string;
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

    constructor(
        form?: CredentialFormSchemaType
    ) {
        this.ID = form?.ID ? String(form.ID).trim() : ulid();

        this.Type = form?.Type ?? VaultUtilTypes.ItemType.Credentials;
        this.GroupID = form?.GroupID ? String(form.GroupID).trim() : "";

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
export const assimilateImportedCredential = async (credential: VaultUtilTypes.Credential) => {
    let newCredential = new VaultCredential();
    
    // Save the new credential's ID before we overwrite it with the imported one
    const generatedID = newCredential.ID;

    newCredential = Object.assign(new VaultCredential(), credential);
    
    // Restore the new credential's ID
    newCredential.ID = generatedID;

    // Recalculate the hash of the credential
    newCredential.Hash = await hashCredential(newCredential);

    return newCredential;
}

const prepareCredentialForHashing = (credential: VaultCredential) => {
    // NOTE: When adding new fields, make sure to add them to the includedFields array
    // The excluded fields are also listed here (commented out) for reference
    const includedFields: (keyof VaultCredential)[] = [
        "ID",
        "Type",
        "GroupID",
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
    const excludedFields: (keyof VaultCredential)[] = ["TOTP", "CustomFields", "Hash"];

    let concatenatedValues = "";

    includedFields.forEach((key) => {
        // NOTE: Ran some performance test on this check; it's faster than actually checking
        //  if the key is of the value we're looking for
        if (!excludedFields.includes(key)) {
            // Concatenate the value of the field to the string
            concatenatedValues += String(credential[key] ?? "");
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
export const createCredential = async (
    data: CredentialFormSchemaType,
) => {
    const newCreds = new VaultCredential(data);

    newCreds.Hash = await hashCredential(newCreds);

    return newCreds;
};

export const updateCredentialFromForm = async (
    existingCredential: VaultCredential,
    form: CredentialFormSchemaType,
) => {
    // const modedCredential = updateCredential(existingCredential, form);
    const moddedCredential = Object.assign(new VaultCredential(), existingCredential);

    const today = Date.now();

    // The ID cannot be changed, so we don't check for it
    // this.ID = form.ID ?? this.ID;

    moddedCredential.Type = form.Type ?? existingCredential.Type;
    moddedCredential.GroupID = form.GroupID ?? existingCredential.GroupID;

    moddedCredential.Name = form.Name ?? existingCredential.Name;
    moddedCredential.Username =
        form.Username ?? existingCredential.Username;

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

//#region Group Methods
export const upsertGroup = (
    existingGroup: Group | null,
    form: GroupSchemaType,
) => {
    if (existingGroup) {
        // const originalGroup = Object.assign({}, existingGroup);

        if (form.Name) existingGroup.Name = form.Name;
        if (form.Icon) existingGroup.Icon = form.Icon;
        if (form.Color) existingGroup.Color = form.Color;

        return existingGroup;
    } else {
        const newGroup = new Group(form.Name, form.Icon, form.Color);

        newGroup.ID = form?.ID ?? ulid();

        if (form.ID) newGroup.ID = form.ID;

        return newGroup;
    }
};

//export const deleteGroup = (id: string): void => {
//    const index = this.Groups.findIndex((g) => g.ID === id);

//    if (index >= 0) {
//        this.Groups.splice(index, 1);
//    }
//};
//#endregion Group Methods

/**
 * Packages the vault for linking to another device.
 * This is done by creating a copy of the vault, clearing the online services account and re-binding it with the new account.
 * @param newOnlineServicesAccount Credentials for the new account to bind to the vault (that will be used on the other device)
 * @returns A new Vault object ready for serialization and transfer
 */
export const packageForLinking = (
    instance: Vault,
    deviceID: string,
    apiKey: string | undefined,
    stunServerIDs: string[],
    turnServerIDs: string[],
    signalingServerID: string,
): Vault => {
    // Create a copy of the vault so we don't modify the original
    const vaultCopy = Object.assign(new Vault(), instance);

    // NOTE: Even if this vault never had any linked devices, it will always have at least on diff in the diff list
    // This is to ensure that both devices can synchronize with each other even if they diverge right after linking

    // Clear the online services account and re-bind it with the new account for the other device
    vaultCopy.LinkedDevices = new LinkedDevices();

    // Make sure the device has the same Linking configuration as the original vault
    vaultCopy.LinkedDevices.STUNServers = instance.LinkedDevices.STUNServers;
    vaultCopy.LinkedDevices.TURNServers = instance.LinkedDevices.TURNServers;
    vaultCopy.LinkedDevices.SignalingServers =
        instance.LinkedDevices.SignalingServers;

    // In case this linked device uses the Cryptex Vault Online Services (API key exists), we need to bind the account
    if (apiKey) {
        LinkedDevices.bindAccount(vaultCopy.LinkedDevices, apiKey);
    } else {
        vaultCopy.LinkedDevices.ID = deviceID;
    }

    // Since this device is the one linking, we can call it the root device
    const deviceName = "Root Device";

    // Plant this device as a linked device in the new vault
    LinkedDevices.addLinkedDevice(
        vaultCopy.LinkedDevices,
        instance.LinkedDevices.ID,
        deviceName,
        true,
        stunServerIDs,
        turnServerIDs,
        signalingServerID,
        instance.LinkedDevices.CreationTimestamp,
    );

    // Make sure we add all the other linked devices to this vault
    instance.LinkedDevices.Devices.forEach((device) => {
        LinkedDevices.addLinkedDevice(
            vaultCopy.LinkedDevices,
            device.ID,
            device.Name,
            device.IsRoot,
            device.STUNServerIDs,
            device.TURNServerIDs,
            device.SignalingServerID,
            device.LinkedAtTimestamp,
            device.AutoConnect,
            device.SyncTimeout,
            device.SyncTimeoutPeriod,
        );
    });

    return vaultCopy;
};

