// src/server/router/index.ts
import { router } from "./trpc";
import {
    userRouterDelete,
    userRouterGenerateRecoveryToken,
    userRouterConfiguration,
    userRouterRecover,
    userRouterRegister,
} from "./routes/v1/user.router";
import {
    deviceRouterLinked,
    deviceRouterLink,
    deviceRouterRemove,
    deviceRouterSignalingAuth,
    deviceRouterSignalingAuthChannel,
    deviceRouterSetRoot,
} from "./routes/v1/device.router";
import {
    feedbackRouterContact,
    feedbackRouterGiveFeedback,
    feedbackRouterNotifyMe,
} from "./routes/v1/feedback.router";
import {
    featureVotingRouterGetRounds,
    featureVotingRouterOpenRoundExists,
    featureVotingRouterPlaceVote,
} from "./routes/v1/feature-voting.router";
import {
    paymentRouterGetCheckoutURL,
    paymentRouterGetCustomerPortal,
    paymentRouterGetSubscription,
} from "./routes/v1/payment.router";

const _versionedRouter = router({
    v1: router({
        feedback: router({
            notifyMe: feedbackRouterNotifyMe,
            contact: feedbackRouterContact,
            feedback: feedbackRouterGiveFeedback,
        }),
        user: router({
            register: userRouterRegister,
            recover: userRouterRecover,
            generateRecoveryToken: userRouterGenerateRecoveryToken,
            clearRecoveryToken: userRouterGenerateRecoveryToken,
            configuration: userRouterConfiguration,
            delete: userRouterDelete,
        }),
        device: router({
            link: deviceRouterLink,
            remove: deviceRouterRemove,
            linked: deviceRouterLinked,
            setRoot: deviceRouterSetRoot,
            signalingAuth: deviceRouterSignalingAuth,
            signalingAuthChannel: deviceRouterSignalingAuthChannel,
        }),
        featureVoting: router({
            openRoundExists: featureVotingRouterOpenRoundExists,
            rounds: featureVotingRouterGetRounds,
            placeVote: featureVotingRouterPlaceVote,
        }),
        payment: router({
            checkoutURL: paymentRouterGetCheckoutURL,
            customerPortal: paymentRouterGetCustomerPortal,
            subscription: paymentRouterGetSubscription,
        }),
    }),
});

export const versionedRouter = _versionedRouter;
export type VersionedRouter = typeof versionedRouter;
