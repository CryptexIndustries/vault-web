// src/server/router/index.ts
import { router } from "./trpc";
import {
    userRouterDelete,
    userRouterDeleteChallenge,
    userRouterGenerateRecoveryToken,
    userRouterRotateRecoveryToken,
    userRouterConfiguration,
} from "./routes/v1/user.router";
import {
    authRouterChallenge,
    authRouterLogout,
    authRouterRecover,
    authRouterRefresh,
    authRouterRegister,
    authRouterVerify,
} from "./routes/v1/auth.router";
import {
    deviceRouterLinked,
    deviceRouterLink,
    deviceRouterRemove,
    deviceRouterSignalingAuthChannel,
    deviceRouterTurnCredentials,
    deviceRouterSetRoot,
    deviceRouterTopology,
    deviceRouterBreakLink,
} from "./routes/v1/device.router";
import {
    paymentRouterGetCheckoutSession,
    paymentRouterGetCustomerPortal,
    paymentRouterGetSubscription,
} from "./routes/v1/payment.router";

import {
    backupRouterDisable,
    backupRouterEnable,
    backupRouterStatus,
} from "./routes/v1/backup-settings.router";
import {
    backupRouterCompleteUpload,
    backupRouterCreateDownload,
    backupRouterCreateUpload,
    backupRouterDelete,
    backupRouterDeleteAll,
    backupRouterList,
} from "./routes/v1/backup-snapshots.router";
import {
    backupRouterCreateRecoverySession,
    backupRouterRecoveryDownload,
    backupRouterRecoveryList,
} from "./routes/v1/backup-recovery.router";

const _versionedRouter = router({
    v1: router({
        auth: router({
            register: authRouterRegister,
            challenge: authRouterChallenge,
            verify: authRouterVerify,
            refresh: authRouterRefresh,
            recover: authRouterRecover,
            logout: authRouterLogout,
        }),
        user: router({
            generateRecoveryToken: userRouterGenerateRecoveryToken,
            rotateRecoveryToken: userRouterRotateRecoveryToken,
            configuration: userRouterConfiguration,
            deleteChallenge: userRouterDeleteChallenge,
            delete: userRouterDelete,
        }),
        device: router({
            link: deviceRouterLink,
            remove: deviceRouterRemove,
            breakLink: deviceRouterBreakLink,
            linked: deviceRouterLinked,
            topology: deviceRouterTopology,
            setRoot: deviceRouterSetRoot,
            signalingAuthChannel: deviceRouterSignalingAuthChannel,
            turnCredentials: deviceRouterTurnCredentials,
        }),
        payment: router({
            checkoutSession: paymentRouterGetCheckoutSession,
            customerPortal: paymentRouterGetCustomerPortal,
            subscription: paymentRouterGetSubscription,
        }),
        backup: router({
            status: backupRouterStatus,
            enable: backupRouterEnable,
            disable: backupRouterDisable,
            createUpload: backupRouterCreateUpload,
            completeUpload: backupRouterCompleteUpload,
            list: backupRouterList,
            createDownload: backupRouterCreateDownload,
            delete: backupRouterDelete,
            deleteAll: backupRouterDeleteAll,
            createRecoverySession: backupRouterCreateRecoverySession,
            recoveryList: backupRouterRecoveryList,
            recoveryDownload: backupRouterRecoveryDownload,
        }),
    }),
});

export const versionedRouter = _versionedRouter;
export type VersionedRouter = typeof versionedRouter;
