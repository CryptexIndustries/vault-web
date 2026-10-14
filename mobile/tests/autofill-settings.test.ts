import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    AUTO_COPY_TOTP_KEY,
    getCachedAutoCopyTotp,
    loadAutoCopyTotp,
    saveAutoCopyTotp,
} from "@/utils/autofill-settings";

jest.mock("@react-native-async-storage/async-storage", () => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
}));

beforeEach(() => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
});

describe("autofill verification-code copying", () => {
    it("starts disabled before preferences load", () => {
        expect(getCachedAutoCopyTotp()).toBe(false);
    });

    it("defaults off when no preference was saved", async () => {
        await expect(loadAutoCopyTotp()).resolves.toBe(false);
    });

    it("honors an explicit opt-in and opt-out", async () => {
        await saveAutoCopyTotp(true);
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
            AUTO_COPY_TOTP_KEY,
            "true",
        );
        expect(getCachedAutoCopyTotp()).toBe(true);
        jest.mocked(AsyncStorage.getItem).mockResolvedValue("true");
        await expect(loadAutoCopyTotp()).resolves.toBe(true);

        await saveAutoCopyTotp(false);
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
            AUTO_COPY_TOTP_KEY,
            "false",
        );
        jest.mocked(AsyncStorage.getItem).mockResolvedValue("false");
        await expect(loadAutoCopyTotp()).resolves.toBe(false);
    });

    it("fails closed on a storage read failure after a prior opt-in", async () => {
        await saveAutoCopyTotp(true);
        jest.mocked(AsyncStorage.getItem).mockRejectedValue(
            new Error("unavailable"),
        );
        await expect(loadAutoCopyTotp()).resolves.toBe(false);
        expect(getCachedAutoCopyTotp()).toBe(false);
    });
});
