// src/server/router/index.ts
import { router } from "./trpc";
import {
    userRouterClearRecoveryToken,
    userRouterDelete,
    userRouterDeleteChallenge,
    userRouterGenerateRecoveryToken,
    userRouterConfiguration,
} from "./routes/v1/user.router";
import {
    authRouterChallenge,
    authRouterLogout,
    authRouterRecover,
    authRouterRefresh,
    authRouterRegister as authRouterRegisterPasskey,
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
    featureVotingRouterGetRounds,
    featureVotingRouterOpenRoundExists,
    featureVotingRouterPlaceVote,
} from "./routes/v1/feature-voting.router";
import {
    paymentRouterGetCheckoutSession,
    paymentRouterGetCustomerPortal,
    paymentRouterGetSubscription,
} from "./routes/v1/payment.router";

const _versionedRouter = router({
    v1: router({
        auth: router({
            register: authRouterRegisterPasskey,
            challenge: authRouterChallenge,
            verify: authRouterVerify,
            refresh: authRouterRefresh,
            recover: authRouterRecover,
            logout: authRouterLogout,
        }),
        user: router({
            generateRecoveryToken: userRouterGenerateRecoveryToken,
            clearRecoveryToken: userRouterClearRecoveryToken,
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
        featureVoting: router({
            openRoundExists: featureVotingRouterOpenRoundExists,
            rounds: featureVotingRouterGetRounds,
            placeVote: featureVotingRouterPlaceVote,
        }),
        payment: router({
            checkoutSession: paymentRouterGetCheckoutSession,
            customerPortal: paymentRouterGetCustomerPortal,
            subscription: paymentRouterGetSubscription,
        }),
    }),
});

export const versionedRouter = _versionedRouter;
export type VersionedRouter = typeof versionedRouter;
