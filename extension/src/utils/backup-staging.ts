/** One-shot IndexedDB staging for encrypted `.cryx` bytes. DEK never stored. */

const DB_NAME = "cryptex-backup-staging";
const STORE_NAME = "blobs";
const DB_VERSION = 1;

const STAGING_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BackupBlobStore = {
    put(id: string, bytes: Uint8Array): Promise<void>;
    take(id: string): Promise<Uint8Array | null>;
    clear(): Promise<void>;
};

type StagedBackupRecord = {
    id: string;
    bytes: Uint8Array;
    createdAt: number;
};

export function isBackupStagingId(value: string): boolean {
    return STAGING_ID_PATTERN.test(value);
}

function openStagingDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => {
            reject(request.error ?? new Error("BACKUP_STAGE_FAILED"));
        };
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        request.onsuccess = () => {
            resolve(request.result);
        };
    });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            reject(request.error ?? new Error("BACKUP_STAGE_FAILED"));
        };
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            resolve();
        };
        tx.onerror = () => {
            reject(tx.error ?? new Error("BACKUP_STAGE_FAILED"));
        };
        tx.onabort = () => {
            reject(tx.error ?? new Error("BACKUP_STAGE_FAILED"));
        };
    });
}

export function createIndexedDbBackupBlobStore(): BackupBlobStore {
    return {
        async put(id: string, bytes: Uint8Array): Promise<void> {
            if (!isBackupStagingId(id)) {
                throw new Error("BACKUP_STAGE_FAILED");
            }
            const db = await openStagingDb();
            try {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const record: StagedBackupRecord = {
                    id,
                    bytes: new Uint8Array(bytes),
                    createdAt: Date.now(),
                };
                tx.objectStore(STORE_NAME).put(record);
                await transactionDone(tx);
            } finally {
                db.close();
            }
        },

        async take(id: string): Promise<Uint8Array | null> {
            if (!isBackupStagingId(id)) return null;
            const db = await openStagingDb();
            try {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const record = await requestToPromise(
                    store.get(id) as IDBRequest<StagedBackupRecord | undefined>,
                );
                store.delete(id);
                await transactionDone(tx);
                if (!record || !(record.bytes instanceof Uint8Array)) {
                    return null;
                }
                return new Uint8Array(record.bytes);
            } finally {
                db.close();
            }
        },

        async clear(): Promise<void> {
            const db = await openStagingDb();
            try {
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).clear();
                await transactionDone(tx);
            } finally {
                db.close();
            }
        },
    };
}
