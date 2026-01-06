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
    private LATEST_VERSION = 2;

    /**
     * NOTE: This property is **not** serialized and saved in the vault
     * The secret used to encrypt the vault while it's in memory.
     * It is also use to decrypt the vault data (if it's encrypted using symmetric encryption).
     */
    public Secret = new Uint8Array();

    public Version: number;
    public CurrentVersion = 0;
    public Configuration: Configuration = new Configuration();
    public LinkedDevices: LinkedDevices;
    public Groups: Group[] = [];
    public Credentials: VaultCredential[];
    public Diffs: VaultUtilTypes.Diff[] = [];

    constructor(secret = new Uint8Array(), seedData = false, seedCount = 0) {
        this.Version = this.LATEST_VERSION;
        this.Secret = secret;

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
            this.Diffs = [];

            // Set the current version to 2
            this.CurrentVersion = 2;

            console.warn("Upgraded Vault object to version 2.");
        }
    }

    /**
     * Seeds the vault with mock credentials
     * @param num - Number of credentials to seed the vault with
     * @returns An array of mock credentials
     */
    private seedVault(num: number): VaultCredential[] {
        // Make sure to only include this in the development build
        if (process.env.NODE_ENV === "development") {
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

        return [];
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

/**
 * Configuration options for the vault.
 */
export class Configuration implements VaultUtilTypes.Configuration {
    /**
     * The maximum number of diffs to store in the vault.
     * This is used to minimize the amount of user interaction required when syncing.
     * It is set to a fixed number in order to prevent the vault from growing too large.
     * NOTE: This is serialized and saved in the vault, so changing the value here will not affect existing vaults.
     * @default 500
     */
    public MaxDiffCount = 500;

    /**
     * Whether or not to save only the latest diff when no linked devices are available.
     * This is used to minimize the amount of storage space used by the vault when there are no linked devices.
     * @default true
     */
    public SaveOnlyLatestDiffWhenNoLinked = true;

    /**
     * Whether or not to inhibit diff generation.
     * This is mainly used when testing to ease the load on the CPU.
     * @default false
     */
    public InhibitDiffGeneration = false;

    public static setMaxDiffCount(
        instance: Configuration,
        count: number,
    ): void {
        instance.MaxDiffCount = Math.abs(count);
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
    DateCreated: z.string().optional(), // Used only in diffing
    DateModified: z.string().optional(), // Used only in diffing
    DatePasswordChanged: z.string().optional(), // Used only in diffing
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
    public DateCreated: string;
    public DateModified?: string | undefined;
    public DatePasswordChanged?: string | undefined;
    public CustomFields: CustomField[];
    public Hash?: string | undefined;

    constructor(
        form?: CredentialFormSchemaType | VaultUtilTypes.PartialCredential,
    ) {
        this.ID = form?.ID ? String(form.ID).trim() : ulid();

        this.Type = form?.Type ?? VaultUtilTypes.ItemType.Credentials;
        this.GroupID = form?.GroupID ? String(form.GroupID).trim() : "";

        this.Name = form?.Name ? String(form.Name).trim() : "Unnamed item";
        this.Username = form?.Username ? String(form.Username).trim() : "";
        this.Password = form?.Password ? String(form.Password).trim() : "";
        // TODO: Remove this object assignment
        this.TOTP = form?.TOTP
            ? Object.assign(new TOTP(), form.TOTP)
            : undefined;
        this.Tags = form?.Tags ? String(form.Tags).trim() : "";
        this.URL = form?.URL ? String(form.URL).trim() : "";
        this.Notes = form?.Notes ? String(form.Notes).trim() : "";

        this.DateCreated = form?.DateCreated ?? new Date().toISOString();
        this.DateModified = form?.DateModified ?? undefined;
        this.DatePasswordChanged = form?.DatePasswordChanged ?? undefined;

        this.CustomFields = form?.CustomFields ?? [];
    }
}

export const updateCredential = (
    existingCredential: VaultCredential,
    form: CredentialFormSchemaType | null = null,
    diff: VaultUtilTypes.DiffChange | null = null,
) => {
    if (diff && diff.Props && diff.Props.ChangeFlags) {
        if (diff.Props.ChangeFlags.TypeHasChanged)
            existingCredential.Type =
                diff.Props.Type ?? existingCredential.Type;

        if (diff.Props.ChangeFlags.GroupIDHasChanged)
            existingCredential.GroupID =
                diff.Props.GroupID ?? existingCredential.GroupID;

        if (diff.Props.ChangeFlags.NameHasChanged)
            existingCredential.Name =
                diff.Props.Name ?? existingCredential.Name;

        if (diff.Props.ChangeFlags.UsernameHasChanged)
            existingCredential.Username =
                diff.Props.Username ?? existingCredential.Username;

        if (diff.Props.ChangeFlags.PasswordHasChanged)
            existingCredential.Password =
                diff.Props.Password ?? existingCredential.Password;

        if (diff.Props.ChangeFlags.TOTPHasChanged)
            existingCredential.TOTP = diff.Props.TOTP
                ? Object.assign(new TOTP(), diff.Props.TOTP)
                : undefined;

        if (diff.Props.ChangeFlags.TagsHasChanged)
            existingCredential.Tags =
                diff.Props.Tags ?? existingCredential.Tags;

        if (diff.Props.ChangeFlags.URLHasChanged)
            existingCredential.URL = diff.Props.URL ?? existingCredential.URL;

        if (diff.Props.ChangeFlags.NotesHasChanged)
            existingCredential.Notes =
                diff.Props.Notes ?? existingCredential.Notes;

        if (diff.Props.ChangeFlags.DateCreatedHasChanged)
            existingCredential.DateCreated =
                diff.Props.DateCreated ?? existingCredential.DateCreated;

        if (diff.Props.ChangeFlags.DateModifiedHasChanged)
            existingCredential.DateModified =
                diff.Props.DateModified ?? existingCredential.DateModified;

        if (diff.Props.ChangeFlags.DatePasswordChangedHasChanged)
            existingCredential.DatePasswordChanged =
                diff.Props.DatePasswordChanged ??
                existingCredential.DatePasswordChanged;

        if (diff.Props.ChangeFlags.CustomFieldsHasChanged)
            existingCredential.CustomFields =
                diff.Props.CustomFields ?? existingCredential.CustomFields;
    } else if (form) {
        const today = new Date().toISOString();

        // The ID cannot be changed, so we don't check for it
        // this.ID = form.ID ?? this.ID;

        existingCredential.Type = form.Type ?? existingCredential.Type;
        existingCredential.GroupID = form.GroupID ?? existingCredential.GroupID;

        existingCredential.Name = form.Name ?? existingCredential.Name;
        existingCredential.Username =
            form.Username ?? existingCredential.Username;

        // Only update the DatePasswordChanged if the password has changed
        // existingCredential only takes a non nullish value of the password into account
        if (
            existingCredential.Password !==
            (form.Password ?? existingCredential.Password)
        ) {
            existingCredential.Password =
                form.Password ?? existingCredential.Password;
            existingCredential.DatePasswordChanged = today;
        }

        existingCredential.TOTP = form.TOTP
            ? Object.assign(new TOTP(), form.TOTP)
            : undefined;
        existingCredential.Tags = form.Tags ?? existingCredential.Tags;
        existingCredential.URL = form.URL ?? existingCredential.URL;
        existingCredential.Notes = form.Notes ?? existingCredential.Notes;

        // The date created cannot be changed, so we don't check for it
        // existingCredential.DateCreated = form.DateCreated ?? existingCredential.DateCreated;

        existingCredential.DateModified = today;

        existingCredential.CustomFields =
            form.CustomFields ?? existingCredential.CustomFields;
    }

    // Reset the hash - it will be recalculated when needed
    existingCredential.Hash = undefined;

    return existingCredential;
};

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
        "CustomFields",
        // "Hash",
    ];

    // These are the fields we don't want to blindly concatenate, so we exclude them and handle them separately (if needed)
    const excludedFields: (keyof VaultCredential)[] = ["TOTP", "Hash"];

    let concatenatedValues = "";

    includedFields.forEach((key) => {
        // NOTE: Ran some performance test on this check; it's faster than actually checking
        //  if the key is of the value we're looking for
        if (!excludedFields.includes(key)) {
            // Concatenate the value of the field to the string
            concatenatedValues += String(credential[key] ?? "");
        }
    });

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
 * Determines the changes done to a credential and returns them in the form of a DiffChange object.
 * @param prevCredential - The previous credential object
 * @param nextCredential - The new credential object
 * @returns The nextCredential object if it's a new credential (prevCredential is undefined)
 * @returns The changes done to the credential in the form of a DiffChange object
 */
export const getCredentialChanges = (
    prevCredential: VaultCredential,
    nextCredential: VaultCredential,
): VaultUtilTypes.DiffChange => {
    // Normalize the previous and next credentials objects
    prevCredential = Object.assign({}, prevCredential);
    nextCredential = Object.assign({}, nextCredential);

    const changeFlags: VaultUtilTypes.PartialCredentialChanges = {
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

    const craftedCredentials: VaultUtilTypes.PartialCredential = {
        CustomFields: [],
    };

    // Note: Don't diff the credential type, we won't support that for now

    if (prevCredential.GroupID !== nextCredential.GroupID) {
        craftedCredentials.GroupID = nextCredential.GroupID;
        changeFlags.GroupIDHasChanged = true;
    }

    if (prevCredential.Name !== nextCredential.Name) {
        craftedCredentials.Name = nextCredential.Name;
        changeFlags.NameHasChanged = true;
    }

    if (prevCredential.Username !== nextCredential.Username) {
        craftedCredentials.Username = nextCredential.Username;
        changeFlags.UsernameHasChanged = true;
    }

    if (prevCredential.Password !== nextCredential.Password) {
        craftedCredentials.Password = nextCredential.Password;
        changeFlags.PasswordHasChanged = true;
    }

    if (
        JSON.stringify(prevCredential.TOTP) !==
        JSON.stringify(nextCredential.TOTP)
    ) {
        craftedCredentials.TOTP = nextCredential.TOTP
            ? Object.assign({}, nextCredential.TOTP)
            : undefined;
        changeFlags.TOTPHasChanged = true;
    }

    if (prevCredential.Tags !== nextCredential.Tags) {
        craftedCredentials.Tags = nextCredential.Tags;
        changeFlags.TagsHasChanged = true;
    }

    if (prevCredential.URL !== nextCredential.URL) {
        craftedCredentials.URL = nextCredential.URL;
        changeFlags.URLHasChanged = true;
    }

    if (prevCredential.Notes !== nextCredential.Notes) {
        craftedCredentials.Notes = nextCredential.Notes;
        changeFlags.NotesHasChanged = true;
    }

    if (prevCredential.DateCreated !== nextCredential.DateCreated) {
        craftedCredentials.DateCreated = nextCredential.DateCreated;
        changeFlags.DateCreatedHasChanged = true;
    }

    if (prevCredential.DateModified !== nextCredential.DateModified) {
        craftedCredentials.DateModified = nextCredential.DateModified;
        changeFlags.DateModifiedHasChanged = true;
    }

    if (
        prevCredential.DatePasswordChanged !==
        nextCredential.DatePasswordChanged
    ) {
        craftedCredentials.DatePasswordChanged =
            nextCredential.DatePasswordChanged;
        changeFlags.DatePasswordChangedHasChanged = true;
    }

    return {
        Type: VaultUtilTypes.DiffType.Update,
        ID: nextCredential.ID,
        Props: {
            ...craftedCredentials,
            ChangeFlags: changeFlags,
        },
    };
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

//#region Diffing
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

/**
 * Convert the vault's credentials to diffs (additions).
 * This is useful when moving the whole vault over the Sync network.
 * @param credentials - The credentials to convert to diffs
 * @returns An array of diffs (type add)
 * @returns An error if there was an error during credential creation
 */
export const credentialsAsDiffs = async (credentials: VaultCredential[]) => {
    const credStorage: VaultCredential[] = [];
    const diffStorage: VaultUtilTypes.Diff[] = [];

    // TODO: If this is no longer needed, remove it
    //clonedVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

    for (const cred of getSortedCredentials(credentials)) {
        const data = await createCredential(cred);

        // Push the new credential to the list
        credStorage.push(data.credential);

        // Hash the credential list
        const listHash = await hashCredentials(credStorage);

        // Using the new credential change and the list hash, create a diff
        const diff: VaultUtilTypes.Diff = {
            Hash: listHash,
            Changes: data.changes,
        };

        diffStorage.push(diff);
    }

    return diffStorage;
};

/**
 * Gets the diffs for the vault from the specified hash to the latest diff.
 * @param hash - The hash to start from
 * @param diffList - The list of diffs to search through
 * @returns An array of diffs from the specified hash to the latest diff (in that order)
 * @returns An empty array if the hash is not found or that is the latest diff
 */
export const getDiffsSinceHash = (
    hash: string,
    diffList: VaultUtilTypes.Diff[],
): VaultUtilTypes.Diff[] => {
    const startIndex = diffList.findIndex((diff) => diff.Hash === hash);

    // If the hash is not found, return an empty array
    if (startIndex === -1) {
        return [];
    }

    // If the hash is found, return the diffs from that index to the end of the array
    return diffList.slice(startIndex + 1);
};

/**
 * Applies the given diffs to the existing credentials list.
 * @returns An array of diffs that were successfully applied and the complete credentials list
 */
export const applyDiffs = async (
    existingCredentials: VaultCredential[],
    diffs: VaultUtilTypes.Diff[],
) => {
    // TODO: Check if this still modifies the existingCredential's items
    let credStorage: VaultCredential[] = [...existingCredentials];
    const diffStorage: VaultUtilTypes.Diff[] = [];

    // Apply the diffs in order
    for (const diff of diffs) {
        let changes: VaultUtilTypes.DiffChange | null = null;

        if (
            diff.Changes?.Type === VaultUtilTypes.DiffType.Add &&
            diff.Changes?.Props
        ) {
            const data = await createCredential(diff.Changes.Props);

            credStorage.push(data.credential);
            changes = data.changes;
        } else if (
            diff.Changes?.Type === VaultUtilTypes.DiffType.Update &&
            diff.Changes?.Props
        ) {
            const credentialIndex = credStorage.findIndex(
                (cred) => cred.ID === diff.Changes?.ID,
            );
            const credential = credStorage[credentialIndex];

            // If we tried to update a credential that doesn't exist, we're probably dealing with a corrupted diff list
            if (!credential)
                return err(
                    `Tried to update a credential that doesn't exist. ID: ${diff.Changes.ID}`,
                );

            const data = await updateCredentialFromDiff(
                credential,
                diff.Changes,
            );

            credStorage[credentialIndex] = data.credential;
            changes = data.changes;
        } else if (diff.Changes?.Type === VaultUtilTypes.DiffType.Delete) {
            // Remove the credential from the list
            const result = deleteCredential(credStorage, diff.Changes.ID);

            // If the delete failed, we're probably dealing with a corrupted diff list
            if (result.isErr()) return err(result.error);

            // Reassign the whole list, because deleteCredential mutates the list and returns it
            credStorage = result.value.credentials;
            changes = result.value.change;
        }

        if (!changes)
            return err(
                "Was processing a diff, but no changes were produced...",
            );

        const listHash = await hashCredentials(credStorage);
        const newDiff: VaultUtilTypes.Diff = {
            Hash: listHash,
            Changes: changes,
        };
        diffStorage.push(newDiff);
    }

    return ok({
        credentials: credStorage,
        diffs: diffStorage,
    });
};

//#endregion Diffing

//#region Credential Methods
/**
 * Creates a credential from the given data.
 * @remarks You might want to create a diff after creating a credential, but this is not necessary.
 * @param data The form data with which to create the credential.
 * - The data can come from the frontend (CredentialFormSchemaType) or from a diff (PartialCredential) we're applying.
 * @returns The new credential and the changes that were made to it
 */
export const createCredential = async (
    data: CredentialFormSchemaType | VaultUtilTypes.PartialCredential,
) => {
    const newCreds = new VaultCredential(data);

    //if (!this.Configuration.InhibitDiffGeneration) {
    // Recalculate the hash, since the credential has been updated
    newCreds.Hash = await hashCredential(newCreds);
    //}

    // This creates an 'Add' type diff - because the credential didn't exist before
    //const change = Credential.getChanges(undefined, newCreds);
    //const partialCredential = Object.assign({}, newCreds);
    // Remove the Hash property from the partial credential (since it doesn't exist in the PartialCredential type, and we're not syncing it)
    // TODO: This is probably unnecessary, remove it when verified
    //delete partialCredential.Hash;
    const changes: VaultUtilTypes.DiffChange = {
        Type: VaultUtilTypes.DiffType.Add,
        ID: newCreds.ID,
        Props: newCreds,
    };

    return {
        credential: newCreds,
        changes,
    };
};

export const updateCredentialFromDiff = async (
    existingCredential: VaultCredential,
    diff: VaultUtilTypes.DiffChange,
) => {
    const originalCredentials = Object.assign({}, existingCredential);
    const moddedCredentials = updateCredential(existingCredential, null, diff);

    // Recalculate the hash, since the credential has been updated
    moddedCredentials.Hash = await hashCredential(moddedCredentials);

    const changes = getCredentialChanges(
        originalCredentials,
        moddedCredentials,
    );

    return {
        credential: moddedCredentials,
        changes,
    };
};

export const updateCredentialFromForm = async (
    existingCredential: VaultCredential,
    form: CredentialFormSchemaType,
) => {
    const originalCredentials = Object.assign({}, existingCredential);
    const moddedCredentials = updateCredential(existingCredential, form, null);

    //if (!this.Configuration.InhibitDiffGeneration) {
    // Recalculate the hash, since the credential has been updated
    moddedCredentials.Hash = await hashCredential(moddedCredentials);
    //}

    const changes = getCredentialChanges(
        originalCredentials,
        moddedCredentials,
    );

    return {
        credential: moddedCredentials,
        changes,
    };
};

/**
 * Mutates the given list of credentials by deleting the credential with the given ID.
 * Then creates a change object necessary for diffing the changes.
 * @param credentialsList The list of credentials to delete from
 * @param id The ID of the credential to delete
 * @returns An object containing the following:
 * - credentials: The list of credentials after the credential was deleted
 *      - This is the same list as the one passed in as an argument to this function
 * - change: The DiffChange object for deleting the credential
 */
export const deleteCredential = (
    credentialsList: VaultCredential[],
    id: string,
) => {
    const index = credentialsList.findIndex((c) => c.ID === id);

    // If we didn't find the credential, return an error
    if (index === -1) return err("Credential not found");

    credentialsList.splice(index, 1);

    const change: VaultUtilTypes.DiffChange = {
        Type: VaultUtilTypes.DiffType.Delete,
        ID: id,
    };

    return ok({
        credentials: credentialsList,
        change: change,
    });
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
    const vaultCopy = Object.assign(new Vault(instance.Secret), instance);

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

/**
 * Calculates the hash of the given credential set and returns it.
 * @returns A hash in the form of a hex string
 */
export const calculateMockedVaultHash = async (
    credentials: VaultCredential[],
    diffs: VaultUtilTypes.Diff[],
) => {
    const credentialsStorage: VaultCredential[] = [];

    // Copy the credentials from the original list into ours so we avoid mutation
    for (const cred of credentials) {
        const data = await createCredential(cred);

        // Add the credential to internal list
        credentialsStorage.push(data.credential);
    }

    const applyDiffResult = await applyDiffs(credentialsStorage, diffs);
    if (applyDiffResult.isErr()) return err(applyDiffResult.error);

    return ok(await hashCredentials(applyDiffResult.value.credentials));
};
