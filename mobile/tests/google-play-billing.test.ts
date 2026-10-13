import { beforeEach, expect, it, jest } from "@jest/globals";

let userId = "account-a",
    generation = 1;
let session: {
    deviceId: string;
    sessionToken: string;
    sessionExpiresAt: number;
} | null;
let billing: typeof import("@/app_lib/google-play-billing");
const subscribers: Array<() => void> = [];
const mockSdk = {
    configure: jest.fn(),
    isConfigured: jest.fn<() => Promise<boolean>>(),
    getAppUserID: jest.fn<() => Promise<string>>(),
    isAnonymous: jest.fn<() => Promise<boolean>>(),
    logIn: jest.fn<() => Promise<unknown>>(),
    logOut: jest.fn<() => Promise<unknown>>(),
    getCustomerInfo:
        jest.fn<() => Promise<{ activeSubscriptions: string[] }>>(),
    getProducts: jest.fn<() => Promise<unknown>>(),
    purchaseSubscriptionOption: jest.fn<() => Promise<unknown>>(),
    restorePurchases:
        jest.fn<() => Promise<{ activeSubscriptions: string[] }>>(),
};
const customer = () => ({
    enabled: true,
    appUserId: `rc-${userId}`,
    canPurchase: true,
});
const mockCustomer = jest.fn<() => Promise<ReturnType<typeof customer>>>();
const mockSync = jest.fn<() => Promise<void>>();
const mockSubscription = jest.fn<() => Promise<{ nonFree: boolean }>>();
const mockConfiguration = jest.fn<() => Promise<void>>();
jest.mock("@/app_lib/auth-session", () => ({
    syncOnlineServicesRemoteConfiguration: () => mockConfiguration(),
}));
jest.mock("@/utils/trpc", () => ({
    trpc: {
        v1: {
            payment: {
                revenueCatCustomer: { query: () => mockCustomer() },
                syncRevenueCat: { mutate: () => mockSync() },
                subscription: { query: () => mockSubscription() },
            },
        },
    },
}));
jest.mock("react-native", () => ({ Linking: { openURL: jest.fn() } }));
jest.mock("@/app_lib/online-services-billing", () => ({
    isGooglePlayBuild: () => true,
}));
jest.mock("react-native-purchases", () => ({
    __esModule: true,
    default: mockSdk,
}));
jest.mock("@/utils/atoms", () => ({
    getUnlockedVault: () => ({
        OnlineServices: { UserID: userId, DeviceId: "device-a" },
    }),
    onlineServicesDataAtom: "session",
    unlockedVaultMetadataAtom: "vault",
    onlineServicesStore: {
        get: () => session,
        sub: (_atom: unknown, callback: () => void) => {
            subscribers.push(callback);
        },
    },
    vaultStore: { get: () => ({}), sub: jest.fn() },
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: () => generation,
    isSameActiveVaultSession: (value: number) => value === generation,
}));

function option(id: string, period: string) {
    const phase = { recurrenceMode: 1, price: { formatted: "$4.99" } };
    return {
        productId: "premium",
        id,
        isBasePlan: true,
        billingPeriod: { iso8601: period },
        pricingPhases: [phase],
        fullPricePhase: phase,
    };
}
const catalog = [
    {
        subscriptionOptions: [
            option("monthly", "P1M"),
            option("yearly", "P1Y"),
        ],
    },
];
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve!: (value: unknown) => void;
    return {
        promise: new Promise<unknown>((done) => {
            resolve = done;
        }),
        resolve: (value: unknown) => resolve(value),
    };
}
beforeEach(async () => {
    jest.resetModules();
    jest.resetAllMocks();
    subscribers.length = 0;
    userId = "account-a";
    generation = 1;
    session = {
        deviceId: "device-a",
        sessionToken: "token",
        sessionExpiresAt: Date.now() + 600000,
    };
    Object.assign(process.env, {
        EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: "goog_public",
        EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "premium",
        EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID: "monthly",
        EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_PRODUCT_ID: "premium",
        EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_BASE_PLAN_ID: "yearly",
    });
    mockCustomer.mockImplementation(async () => customer());
    mockSync.mockResolvedValue(undefined);
    mockSubscription.mockResolvedValue({ nonFree: false });
    mockSdk.isConfigured.mockResolvedValue(true);
    mockSdk.isAnonymous.mockResolvedValue(false);
    mockSdk.getAppUserID.mockResolvedValue("rc-account-a");
    mockSdk.getProducts.mockResolvedValue(catalog);
    mockSdk.getCustomerInfo.mockResolvedValue({ activeSubscriptions: [] });
    mockSdk.restorePurchases.mockResolvedValue({
        activeSubscriptions: ["premium:monthly"],
    });
    billing = await import("@/app_lib/google-play-billing");
});
it("loads public base-plan prices before signup, then identifies the backend account for purchase", async () => {
    session = null;
    mockSdk.isConfigured.mockResolvedValue(false);
    expect((await billing.loadGooglePlayPlans())[0].price).toBe("$4.99");
    expect(mockSdk.configure).toHaveBeenCalledWith({
        apiKey: "goog_public",
    });
    expect(mockCustomer).not.toHaveBeenCalled();
    expect(mockSdk.logIn).not.toHaveBeenCalled();
    expect((await billing.purchaseGooglePlayPlan("premiumMonthly")).ok).toBe(
        false,
    );
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
    session = {
        deviceId: "device-a",
        sessionToken: "token",
        sessionExpiresAt: Date.now() + 600000,
    };
    mockSdk.isConfigured.mockResolvedValue(true);
    mockSdk.getAppUserID.mockResolvedValue("$RCAnonymousID:test");
    expect((await billing.purchaseGooglePlayPlan("premiumMonthly")).ok).toBe(
        true,
    );
    expect(mockSdk.logIn).toHaveBeenCalledWith("rc-account-a");
});
it("keeps an existing SDK identity during catalog lookup and rejects introductory plans", async () => {
    expect(await billing.loadGooglePlayPlans()).toHaveLength(2);
    expect(mockSdk.configure).not.toHaveBeenCalled();
    expect(mockSdk.logIn).not.toHaveBeenCalled();
    expect(mockSdk.logOut).not.toHaveBeenCalled();
    mockSdk.getProducts.mockResolvedValue([
        {
            subscriptionOptions: [
                { ...option("monthly:trial", "P1M"), isBasePlan: false },
            ],
        },
    ]);
    expect((await billing.purchaseGooglePlayPlan("premiumMonthly")).ok).toBe(
        false,
    );
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
});
it("leaves anonymous catalog setup alone when signing out during price lookup", async () => {
    const pending = deferred();
    mockSdk.isConfigured.mockResolvedValue(false);
    mockSdk.isAnonymous.mockResolvedValue(true);
    mockSdk.getProducts.mockReturnValue(pending.promise);
    const prices = billing.loadGooglePlayPlans();
    await tick();
    session = null;
    subscribers.forEach((callback) => callback());
    mockSdk.isConfigured.mockResolvedValue(true);
    pending.resolve(catalog);
    expect(await prices).toHaveLength(2);
    await tick();
    expect(mockSdk.logOut).not.toHaveBeenCalled();
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
    expect(mockCustomer).not.toHaveBeenCalled();
});
it.each(["lock", "logout"])(
    "cannot start a purchase after %s during product lookup",
    async (change) => {
        const pending = deferred();
        mockSdk.getProducts.mockReturnValue(pending.promise);
        const purchase = billing.purchaseGooglePlayPlan("premiumMonthly");
        await tick();
        if (change === "lock") generation++;
        else {
            const previous = session;
            session = null;
            subscribers.forEach((callback) => callback());
            session = previous;
        }
        pending.resolve(catalog);
        expect((await purchase).ok).toBe(false);
        expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
    },
);
it("serializes account switches behind purchases and rejects old-account results", async () => {
    const pending = deferred();
    mockSdk.purchaseSubscriptionOption.mockReturnValueOnce(pending.promise);
    const purchase = billing.purchaseGooglePlayPlan("premiumMonthly");
    await tick();
    userId = "account-b";
    const restore = billing.restoreGooglePlayPurchases();
    await tick();
    expect(mockSdk.logIn).not.toHaveBeenCalled();
    expect(mockSdk.restorePurchases).not.toHaveBeenCalled();
    pending.resolve({});
    expect((await purchase).ok).toBe(false);
    expect((await restore).ok).toBe(true);
    expect(mockSdk.logIn).toHaveBeenCalledWith("rc-account-b");
});
it("blocks duplicate charges while backend confirmation is delayed", async () => {
    mockSdk.getCustomerInfo.mockResolvedValue({
        activeSubscriptions: ["premium:monthly"],
    });
    expect(await billing.purchaseGooglePlayPlan("premiumYearly")).toMatchObject(
        {
            ok: false,
            pending: true,
        },
    );
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
});
it("does not log out a new session when queued native cleanup finally runs", async () => {
    const pending = deferred();
    mockSdk.purchaseSubscriptionOption.mockReturnValueOnce(pending.promise);
    const purchase = billing.purchaseGooglePlayPlan("premiumMonthly");
    await tick();
    const previous = session;
    session = null;
    subscribers.forEach((callback) => callback());
    session = previous;
    pending.resolve({});
    await purchase;
    await tick();
    expect(mockSdk.logOut).not.toHaveBeenCalled();
    session = null;
    subscribers.forEach((callback) => callback());
    await tick();
    expect(mockSdk.logOut).toHaveBeenCalledTimes(1);
});

it("syncs backend membership only after completed purchase and restore", async () => {
    expect((await billing.purchaseGooglePlayPlan("premiumMonthly")).ok).toBe(
        true,
    );
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockSdk.purchaseSubscriptionOption.mock.invocationCallOrder[0]!,
    );
    mockSdk.restorePurchases.mockResolvedValue({ activeSubscriptions: [] });
    expect((await billing.restoreGooglePlayPurchases()).ok).toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(2);
});

it("permits catalog and restore while backend purchase permission is false", async () => {
    mockCustomer.mockResolvedValue({ ...customer(), canPurchase: false });
    expect(await billing.loadGooglePlayPlans()).toHaveLength(2);
    expect((await billing.purchaseGooglePlayPlan("premiumMonthly")).ok).toBe(
        false,
    );
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
    expect((await billing.restoreGooglePlayPurchases()).ok).toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(1);
});

it("refuses disabled backend billing before touching the SDK", async () => {
    mockCustomer.mockResolvedValue({ ...customer(), enabled: false });
    expect((await billing.purchaseGooglePlayPlan("premiumMonthly")).ok).toBe(
        false,
    );
    expect(mockSdk.configure).not.toHaveBeenCalled();
    expect(mockSdk.logIn).not.toHaveBeenCalled();
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
});

it("does not configure an identity response from a previous vault account", async () => {
    const pending = deferred();
    mockCustomer.mockReturnValue(
        pending.promise as ReturnType<typeof mockCustomer>,
    );
    const purchase = billing.purchaseGooglePlayPlan("premiumMonthly");
    await tick();
    userId = "account-b";
    pending.resolve({ ...customer(), appUserId: "rc-account-a" });
    expect((await purchase).ok).toBe(false);
    expect(mockSdk.configure).not.toHaveBeenCalled();
    expect(mockSdk.logIn).not.toHaveBeenCalled();
});

it("does not sync canceled or pending native purchases", async () => {
    for (const code of ["1", "20"]) {
        mockSdk.purchaseSubscriptionOption.mockRejectedValueOnce({ code });
        expect(
            (await billing.purchaseGooglePlayPlan("premiumMonthly")).ok,
        ).toBe(false);
    }
    mockSdk.purchaseSubscriptionOption.mockRejectedValueOnce({
        userCancelled: true,
    });
    expect(
        await billing.purchaseGooglePlayPlan("premiumMonthly"),
    ).toMatchObject({ ok: false, canceled: true });
    expect(mockSync).not.toHaveBeenCalled();
});

it("checks backend confirmation without another native purchase or restore", async () => {
    expect(await billing.checkGooglePlayPurchaseStatus()).toMatchObject({
        ok: false,
        pending: true,
    });
    mockSubscription.mockResolvedValue({ nonFree: true });
    expect(await billing.checkGooglePlayPurchaseStatus()).toEqual({ ok: true });
    expect(mockSdk.purchaseSubscriptionOption).not.toHaveBeenCalled();
    expect(mockSdk.restorePurchases).not.toHaveBeenCalled();
    expect(mockConfiguration).toHaveBeenCalledTimes(2);
    expect(mockSync.mock.invocationCallOrder[0]).toBeLessThan(
        mockSubscription.mock.invocationCallOrder[0]!,
    );
});

it("does not check another account after a switch during backend synchronization", async () => {
    const pending = deferred();
    mockSync.mockReturnValueOnce(
        pending.promise as ReturnType<typeof mockSync>,
    );
    const check = billing.checkGooglePlayPurchaseStatus();
    await tick();
    userId = "account-b";
    pending.resolve(undefined);
    expect((await check).ok).toBe(false);
    expect(mockSubscription).not.toHaveBeenCalled();
    expect(mockConfiguration).not.toHaveBeenCalled();
});

it("does not expose native diagnostic messages as payment feedback", async () => {
    mockSdk.purchaseSubscriptionOption.mockRejectedValueOnce(
        new Error("Internal raw diagnostic"),
    );
    expect(
        await billing.purchaseGooglePlayPlan("premiumMonthly"),
    ).toMatchObject({
        ok: false,
        message: "Google Play billing could not complete. Please try again.",
    });
});

it("points a refused Play payment at the Google Play payment method", async () => {
    // Google reports a declined card as BILLING_UNAVAILABLE, which RevenueCat maps to code 3.
    mockSdk.purchaseSubscriptionOption.mockRejectedValueOnce(
        Object.assign(new Error("native"), { code: "3" }),
    );
    const result = await billing.purchaseGooglePlayPlan("premiumMonthly");
    expect(result).toEqual({
        ok: false,
        message:
            "Google Play couldn't complete the purchase. Check your payment method in Google Play.",
    });
});

it.each<["purchase" | "restore", string]>([
    ["purchase", "6"],
    ["restore", "7"],
    ["restore", "13"],
])(
    "explains a %s refused because the subscription belongs to another account (code %s)",
    async (operation, code) => {
        const refused = Object.assign(new Error("native"), { code });
        if (operation === "purchase")
            mockSdk.purchaseSubscriptionOption.mockRejectedValueOnce(refused);
        else mockSdk.restorePurchases.mockRejectedValueOnce(refused);
        const result =
            operation === "purchase"
                ? await billing.purchaseGooglePlayPlan("premiumMonthly")
                : await billing.restoreGooglePlayPurchases();
        expect(result).toEqual({
            ok: false,
            retryable: false,
            message: expect.stringContaining("belongs to another Cryptex Vault account"),
        });
        expect(mockSync).not.toHaveBeenCalled();
    },
);

it.each(["purchase", "restore"])(
    "reports confirmation pending when sync fails after native %s succeeds",
    async (operation) => {
        mockSync.mockRejectedValue(new Error("Offline"));
        const result =
            operation === "purchase"
                ? await billing.purchaseGooglePlayPlan("premiumMonthly")
                : await billing.restoreGooglePlayPurchases();
        expect(result).toMatchObject({
            ok: false,
            pending: true,
            message: expect.stringContaining(
                "Membership confirmation is pending",
            ),
        });
        expect(mockSync).toHaveBeenCalledTimes(1);
    },
);

it("does not sync a native purchase for a new account after an account switch", async () => {
    const pending = deferred();
    mockSdk.purchaseSubscriptionOption.mockReturnValue(pending.promise);
    const purchase = billing.purchaseGooglePlayPlan("premiumMonthly");
    await tick();
    userId = "account-b";
    pending.resolve({});
    expect((await purchase).ok).toBe(false);
    expect(mockSync).not.toHaveBeenCalled();
});
