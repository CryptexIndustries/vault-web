/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Options } from "pusher-js";
import {
    initPusherInstance,
    SyncConnectionController,
    type VaultOperations,
} from "../synchronization";
import { ONLINE_SERVICES_SELECTION_ID } from "../consts";
import * as Types from "../proto/vault";

jest.mock("../vault-utils/post-quantum-kem", () => ({}));
jest.mock("../vault-utils/sync-signing", () => ({}));
jest.mock("../vault-utils/sync-crypto", () => ({}));

const pusher = jest.fn();
jest.mock("pusher-js", () => ({
    __esModule: true,
    default: jest.fn((key: string, options: Options) => pusher(key, options)),
}));

const log = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const authorizeSignalingChannel = jest.fn<(input: object) => Promise<object>>();
const forceReauthenticate = jest.fn<() => Promise<boolean>>();
jest.mock("../runtime", () => ({
    getVaultCoreRuntime: () => ({
        syncLog: log,
        signalingLog: log,
        webrtcLog: log,
        env: {
            NEXT_PUBLIC_PUSHER_APP_KEY: "key",
            NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
            NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
            NEXT_PUBLIC_PUSHER_APP_TLS: false,
        },
        onlineServicesApi: { authorizeSignalingChannel },
        onlineServicesSessionPort: { forceReauthenticate },
    }),
}));

const trpcError = (code: string) =>
    Object.assign(new Error(code), { data: { code } });

beforeEach(() => {
    jest.clearAllMocks();
    forceReauthenticate.mockResolvedValue(true);
});

it("never opens a signaling channel for a device linked before sync IDs existed", async () => {
    // Older vaults have no SyncID field, so it decodes as "".
    const legacy = Types.LinkedDevice.decode(
        Types.LinkedDevice.encode(
            Types.LinkedDevice.fromPartial({
                ID: "legacy",
                Name: "Old laptop",
                AutoConnect: true,
                SignalingServerID: ONLINE_SERVICES_SELECTION_ID,
            }),
        ).finish(),
    );
    const controller = new SyncConnectionController({
        getSynchronizationConfig: async () =>
            Types.LinkedDevices.fromPartial({ Devices: [legacy] }),
    } as VaultOperations);

    await expect(controller.connectDevice(legacy.ID)).resolves.toBe(false);
    await expect(controller.connectDevice(legacy.ID)).resolves.toBe(false);

    expect(pusher).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
});

describe("Online Services channel authorization", () => {
    async function authorize() {
        initPusherInstance(null, "sync");
        const options = pusher.mock.calls[0]![1] as Options;
        const next = jest.fn();
        await options.channelAuthorization!.customHandler!(
            { channelName: "presence-sync-sync", socketId: "1.1" },
            next,
        );
        return next;
    }

    it("does not reauthenticate when authorization fails for another reason", async () => {
        const error = trpcError("BAD_REQUEST");
        authorizeSignalingChannel.mockRejectedValue(error);

        const next = await authorize();

        expect(forceReauthenticate).not.toHaveBeenCalled();
        expect(authorizeSignalingChannel).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(error, null);
    });

    it("reauthenticates and retries once on UNAUTHORIZED", async () => {
        const auth = { auth: "key:signature" };
        authorizeSignalingChannel
            .mockRejectedValueOnce(trpcError("UNAUTHORIZED"))
            .mockResolvedValueOnce(auth);

        const next = await authorize();

        expect(forceReauthenticate).toHaveBeenCalledTimes(1);
        expect(authorizeSignalingChannel).toHaveBeenCalledTimes(2);
        expect(next).toHaveBeenCalledWith(null, auth);
    });
});
