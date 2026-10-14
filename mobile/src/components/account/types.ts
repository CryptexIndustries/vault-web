export type AuthMode = "register" | "recover";

export type RecoveryKitData = {
    userId: string;
    recoveryPhrase: string;
};
