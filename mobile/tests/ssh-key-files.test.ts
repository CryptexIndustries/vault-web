import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

import { shareSSHKeyFile } from "@/utils/ssh-key-files";
import { markVaultLockStarted } from "@/utils/vault-lock-epoch";
import {
    captureVaultSession,
    clearVaultDEKFromSession,
    isVaultSessionCurrent,
    setVaultDEKInSession,
} from "@/utils/vault-session";

const mockFiles = new Map<string, string>();
const mockShared: Array<{ path: string; contents: string | undefined }> = [];
const mockNative = {
    available: (): Promise<boolean> => Promise.resolve(true),
    write: (): Promise<void> => Promise.resolve(),
};

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({
    cacheDirectory: "file:///cache/",
    EncodingType: { UTF8: "utf8" },
    makeDirectoryAsync: async () => undefined,
    writeAsStringAsync: async (path: string, contents: string) => {
        await mockNative.write();
        mockFiles.set(path, contents);
    },
    deleteAsync: async (path: string) => {
        for (const file of mockFiles.keys())
            if (file.startsWith(path)) mockFiles.delete(file);
    },
}));
jest.mock("expo-sharing", () => ({
    isAvailableAsync: () => mockNative.available(),
    shareAsync: async (path: string) => {
        mockShared.push({ path, contents: mockFiles.get(path) });
    },
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: { clearProviderCredentials: jest.fn() },
}));

const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n";
const options = {
    mimeType: "application/octet-stream",
    dialogTitle: "Save private key",
};

function held() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

describe("sharing a private key file", () => {
    beforeEach(() => {
        mockFiles.clear();
        mockShared.length = 0;
        mockNative.available = () => Promise.resolve(true);
        mockNative.write = () => Promise.resolve();
        setVaultDEKInSession({ type: "secret" } as CryptoKey);
    });

    afterEach(() => {
        clearVaultDEKFromSession();
    });

    it("shares and then deletes the file while the session lasts", async () => {
        const session = captureVaultSession();
        await expect(
            shareSSHKeyFile("id_ed25519", PRIVATE_KEY, {
                ...options,
                isCurrent: () => isVaultSessionCurrent(session),
            }),
        ).resolves.toBe("shared");
        expect(mockShared).toEqual([
            {
                path: expect.stringContaining("/id_ed25519"),
                contents: PRIVATE_KEY,
            },
        ]);
        expect(mockFiles.size).toBe(0);
    });

    it("writes and shares nothing when a lock starts while sharing is being checked", async () => {
        const session = captureVaultSession();
        const availability = held();
        mockNative.available = () => availability.promise.then(() => true);
        const share = shareSSHKeyFile("id_ed25519", PRIVATE_KEY, {
            ...options,
            isCurrent: () => isVaultSessionCurrent(session),
        });
        markVaultLockStarted();
        availability.release();
        await expect(share).resolves.toBe("cancelled");
        expect(mockShared).toHaveLength(0);
        expect(mockFiles.size).toBe(0);
    });

    it("deletes the file and shares nothing when a lock starts while it is written", async () => {
        const session = captureVaultSession();
        const write = held();
        mockNative.write = () => write.promise;
        const share = shareSSHKeyFile("id_ed25519", PRIVATE_KEY, {
            ...options,
            isCurrent: () => isVaultSessionCurrent(session),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        markVaultLockStarted();
        write.release();
        await expect(share).resolves.toBe("cancelled");
        expect(mockShared).toHaveLength(0);
        expect(mockFiles.size).toBe(0);
    });

    it("stays cancelled when the vault is unlocked again before the native call returns", async () => {
        const session = captureVaultSession();
        const availability = held();
        mockNative.available = () => availability.promise.then(() => true);
        const share = shareSSHKeyFile("id_ed25519", PRIVATE_KEY, {
            ...options,
            isCurrent: () => isVaultSessionCurrent(session),
        });
        markVaultLockStarted();
        clearVaultDEKFromSession();
        setVaultDEKInSession({ type: "secret" } as CryptoKey);
        availability.release();
        await expect(share).resolves.toBe("cancelled");
        expect(mockShared).toHaveLength(0);
    });

    it("reports a device without sharing", async () => {
        mockNative.available = () => Promise.resolve(false);
        await expect(
            shareSSHKeyFile("id_ed25519.pub", "ssh-ed25519 AAAA\n", options),
        ).resolves.toBe("unavailable");
        expect(mockFiles.size).toBe(0);
    });
});
