import { useCallback, useEffect, useRef, useState } from "react";
import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
    ActivityIndicator,
    AppState,
    type AppStateStatus,
    View,
} from "react-native";
import {
    WebView,
    type WebViewMessageEvent,
    type WebViewNavigation,
} from "react-native-webview";
import { AlertCircle, ShieldCheck } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { UnlockedButton } from "@/components/unlocked/unlocked-ui";
import { onlineServicesLog } from "@/utils/logging";
import { colors } from "@/theme";
import { StatusPanel } from "./status-panel";

import {
    assertTurnstileBridgeUrlAllowed,
    buildTurnstileBridgeUrl,
    createTurnstileInstanceNonce,
    isAllowedTurnstileMessageSource,
    isAllowedTurnstileNavigationUrl,
    isTurnstileConfigured,
    parseTurnstileBridgeMessage,
    type TurnstileAction,
} from "./turnstile-bridge";

type ChallengeStatus =
    | "loading"
    | "ready"
    | "success"
    | "error"
    | "expired"
    | "timeout";

type TurnstileChallengeDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Operation-specific allowlisted Turnstile action. */
    action: TurnstileAction;
    /** Called once with a fresh token; caller must not persist it. */
    onToken: (token: string) => void;
    title?: string;
    description?: string;
    placement?: "center" | "bottom";
    /** In the screen's own content, never a modal that could fail to present. */
    inline?: boolean;
};

function TurnstileChallengeDialog({
    open,
    onOpenChange,
    action,
    onToken,
    title,
    description,
    placement = "center",
    inline = false,
}: TurnstileChallengeDialogProps) {
    const { t } = useLingui();
    const [instanceNonce, setInstanceNonce] = useState("");
    const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<ChallengeStatus>("loading");
    const [errorMessage, setErrorMessage] = useState("");
    const [webViewKey, setWebViewKey] = useState(0);
    const deliveredRef = useRef(false);
    const activeNonceRef = useRef("");

    const resetChallenge = useCallback(() => {
        deliveredRef.current = false;
        const nonce = createTurnstileInstanceNonce();
        activeNonceRef.current = nonce;
        setInstanceNonce(nonce);
        const url = buildTurnstileBridgeUrl(nonce, action);
        if (!assertTurnstileBridgeUrlAllowed(url)) {
            setBridgeUrl(null);
            setStatus("error");
            setErrorMessage(
                translate`Turnstile bridge URL must be the app origin over HTTPS (http localhost allowed in development).`,
            );
            return;
        }
        setBridgeUrl(url);
        setStatus("loading");
        setErrorMessage("");
        setWebViewKey((k) => k + 1);
    }, [action]);

    useEffect(() => {
        if (!open) {
            activeNonceRef.current = "";
            setInstanceNonce("");
            setBridgeUrl(null);
            setStatus("loading");
            setErrorMessage("");
            deliveredRef.current = false;
            return;
        }
        resetChallenge();
    }, [open, resetChallenge]);

    useEffect(() => {
        if (!open) return;
        const onAppState = (next: AppStateStatus) => {
            if (next === "background" || next === "inactive") {
                deliveredRef.current = false;
                onOpenChange(false);
            }
        };
        const sub = AppState.addEventListener("change", onAppState);
        return () => sub.remove();
    }, [open, onOpenChange]);

    const handleClose = () => {
        deliveredRef.current = false;
        onOpenChange(false);
    };

    const handleMessage = (event: WebViewMessageEvent) => {
        if (
            !bridgeUrl ||
            !isAllowedTurnstileMessageSource(event.nativeEvent.url, bridgeUrl)
        ) {
            return;
        }
        const message = parseTurnstileBridgeMessage(event.nativeEvent.data);
        if (!message) return;
        if (
            message.instanceNonce !== activeNonceRef.current &&
            message.instanceNonce !== "invalid"
        ) {
            return;
        }

        switch (message.type) {
            case "ready":
                setStatus("ready");
                break;
            case "success": {
                if (deliveredRef.current) return;
                deliveredRef.current = true;
                setStatus("success");
                const token = message.token;
                onToken(token);
                onOpenChange(false);
                break;
            }
            case "error":
                deliveredRef.current = false;
                setStatus("error");
                setErrorMessage(message.message);
                break;
            case "expired":
                deliveredRef.current = false;
                setStatus("expired");
                setErrorMessage(t`Challenge expired. Retry to continue.`);
                break;
            case "timeout":
                deliveredRef.current = false;
                setStatus("timeout");
                setErrorMessage(t`Challenge timed out. Retry to continue.`);
                break;
        }
    };

    const handleShouldStart = (request: WebViewNavigation) => {
        return isAllowedTurnstileNavigationUrl(request.url);
    };

    const handleNavigationStateChange = (nav: WebViewNavigation) => {
        if (!isAllowedTurnstileNavigationUrl(nav.url)) {
            // Block by remounting to the allowlisted bridge URL.
            if (bridgeUrl) {
                setWebViewKey((k) => k + 1);
            }
        }
    };

    const showRetry =
        status === "error" || status === "expired" || status === "timeout";
    useEffect(() => {
        if (showRetry)
            onlineServicesLog.warn("Human check failed", { action, status });
    }, [showRetry, action, status]);

    const errorCard =
        showRetry && errorMessage ? (
            <StatusPanel
                compact
                content={{
                    tone: "error",
                    icon: AlertCircle,
                    title: t`Human check failed`,
                    body: errorMessage,
                }}
            />
        ) : null;
    const webView =
        bridgeUrl && instanceNonce && !showRetry ? (
            <WebView
                key={webViewKey}
                source={{ uri: bridgeUrl }}
                style={{
                    flex: 1,
                    backgroundColor: colors.background,
                }}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                setSupportMultipleWindows={false}
                originWhitelist={[
                    "https://*",
                    "http://*",
                    "about:blank",
                    "about:srcdoc",
                ]}
                onShouldStartLoadWithRequest={handleShouldStart}
                onNavigationStateChange={handleNavigationStateChange}
                onMessage={handleMessage}
                onError={() => {
                    setStatus("error");
                    setErrorMessage(t`Could not load verification page.`);
                }}
                onHttpError={() => {
                    setStatus("error");
                    setErrorMessage(t`Verification page returned an error.`);
                }}
                accessibilityLabel={t`Cloudflare Turnstile verification`}
            />
        ) : null;

    if (inline)
        return open ? (
            <View className="gap-6">
                <StatusPanel
                    content={{
                        tone: status === "loading" ? "progress" : "waiting",
                        icon: ShieldCheck,
                        title: t`Checking you're human`,
                        body: t`Complete the check below. The token is used once and never stored.`,
                    }}
                />
                {errorCard}
                {/* Sized to the Turnstile widget; shown once it is ready to use. */}
                {webView ? (
                    <View
                        style={{
                            height: 72,
                            opacity: status === "loading" ? 0 : 1,
                        }}
                    >
                        {webView}
                    </View>
                ) : null}
                <View className="gap-[9px]">
                    {showRetry ? (
                        <UnlockedButton onPress={resetChallenge}>
                            {t`Retry`}
                        </UnlockedButton>
                    ) : null}
                    <UnlockedButton variant="outline" onPress={handleClose}>
                        {t`Cancel`}
                    </UnlockedButton>
                </View>
            </View>
        ) : null;
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            dismissible
            scroll
            placement={placement}
        >
            <DialogHeader>
                <DialogTitle>{title ?? t`Verify you are human`}</DialogTitle>
                <DialogDescription>
                    {description ??
                        t`Complete the challenge to continue. The verification token is used once and never stored.`}
                </DialogDescription>
            </DialogHeader>
            <DialogContent className="gap-3">
                {status === "loading" || status === "ready" ? (
                    <View className="min-h-[80px] items-center justify-center gap-2">
                        {status === "loading" ? (
                            <>
                                <ActivityIndicator color={colors.primary} />
                                <Text className="text-sm text-muted-foreground">
                                    {t`Loading verification…`}
                                </Text>
                            </>
                        ) : (
                            <Text className="text-sm text-muted-foreground">
                                {t`Complete the challenge below.`}
                            </Text>
                        )}
                    </View>
                ) : null}

                {errorCard}

                {webView ? (
                    <View className="h-[180px] w-full overflow-hidden rounded-md border border-border">
                        {webView}
                    </View>
                ) : null}
            </DialogContent>
            <DialogFooter>
                <Button
                    className="h-[54px] min-h-[54px]"
                    variant="secondary"
                    onPress={handleClose}
                >
                    {t`Cancel`}
                </Button>
                {showRetry ? (
                    <Button
                        className="h-[54px] min-h-[54px]"
                        onPress={resetChallenge}
                    >
                        {t`Retry`}
                    </Button>
                ) : null}
            </DialogFooter>
        </Dialog>
    );
}

/** A check still open by then ends with no token, so the caller can offer a retry. */
export const HUMAN_CHECK_TIMEOUT_MS = 120_000;

/**
 * Request a fresh Turnstile token immediately before a mutation.
 * Caller supplies an allowlisted action (auth_register | auth_recover).
 * Resolves with an empty string when no site key is set, and with null when
 * the check is closed, replaced, unmounted or times out.
 */
export function useTurnstileTokenRequest({
    placement = "center",
    inline = false,
}: {
    placement?: "center" | "bottom";
    inline?: boolean;
} = {}) {
    const [open, setOpen] = useState(false);
    const [action, setAction] = useState<TurnstileAction>("auth_register");
    // Each request gets its own challenge, so an old one cannot answer a new one.
    const [requestId, setRequestId] = useState(0);
    const lastIdRef = useRef(0);
    const pendingRef = useRef<{
        id: number;
        action: TurnstileAction;
        resolve: (token: string | null) => void;
        timer: ReturnType<typeof setTimeout>;
    } | null>(null);

    const settle = useCallback(
        (token: string | null, reason?: string, id?: number) => {
            const pending = pendingRef.current;
            if (!pending || (id !== undefined && id !== pending.id)) return;
            pendingRef.current = null;
            clearTimeout(pending.timer);
            if (token === null)
                onlineServicesLog.warn("Human check ended without a result", {
                    action: pending.action,
                    reason,
                });
            else
                onlineServicesLog.info("Human check passed", {
                    action: pending.action,
                });
            pending.resolve(token);
        },
        [],
    );

    const requestToken = useCallback(
        (nextAction: TurnstileAction): Promise<string | null> => {
            if (!isTurnstileConfigured()) {
                return Promise.resolve("");
            }
            settle(null, "replaced");
            onlineServicesLog.info("Human check opened", {
                action: nextAction,
            });
            const id = ++lastIdRef.current;
            return new Promise((resolve) => {
                pendingRef.current = {
                    id,
                    action: nextAction,
                    resolve,
                    timer: setTimeout(() => {
                        setOpen(false);
                        settle(null, "timed out");
                    }, HUMAN_CHECK_TIMEOUT_MS),
                };
                setAction(nextAction);
                setRequestId(id);
                setOpen(true);
            });
        },
        [settle],
    );

    const handleOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next);
            if (!next) settle(null, "closed");
        },
        [settle],
    );

    useEffect(() => () => settle(null, "unmounted"), [settle]);

    const dialog = (
        <TurnstileChallengeDialog
            key={requestId}
            open={open}
            onOpenChange={(next) => {
                const pending = pendingRef.current;
                if (!pending || pending.id === requestId)
                    handleOpenChange(next);
            }}
            action={action}
            onToken={(token) => settle(token, undefined, requestId)}
            placement={placement}
            inline={inline}
        />
    );

    const cancel = useCallback(
        () => handleOpenChange(false),
        [handleOpenChange],
    );

    return { requestToken, dialog, cancel };
}
