import { useCallback, useEffect, useRef, useState } from "react";
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
import { InlineNotice } from "@/components/inline-notice";
import { colors } from "@/theme";

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
};

function TurnstileChallengeDialog({
    open,
    onOpenChange,
    action,
    onToken,
    title = "Verify you are human",
    description = "Complete the challenge to continue. The verification token is used once and never stored.",
    placement = "center",
}: TurnstileChallengeDialogProps) {
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
                "Turnstile bridge URL must be the app origin over HTTPS (http localhost allowed in development).",
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
            !isAllowedTurnstileMessageSource(
                event.nativeEvent.url,
                bridgeUrl,
            )
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
                setErrorMessage("Challenge expired. Retry to continue.");
                break;
            case "timeout":
                deliveredRef.current = false;
                setStatus("timeout");
                setErrorMessage("Challenge timed out. Retry to continue.");
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

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            dismissible
            scroll
            placement={placement}
        >
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <DialogContent className="gap-3">
                {status === "loading" || status === "ready" ? (
                    <View className="min-h-[80px] items-center justify-center gap-2">
                        {status === "loading" ? (
                            <>
                                <ActivityIndicator color={colors.primary} />
                                <Text className="text-sm text-muted-foreground">
                                    Loading verification…
                                </Text>
                            </>
                        ) : (
                            <Text className="text-sm text-muted-foreground">
                                Complete the challenge below.
                            </Text>
                        )}
                    </View>
                ) : null}

                {showRetry && errorMessage ? (
                    <InlineNotice tone="error" message={errorMessage} />
                ) : null}

                {bridgeUrl && instanceNonce && !showRetry ? (
                    <View className="h-[180px] w-full overflow-hidden rounded-md border border-border">
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
                            onNavigationStateChange={
                                handleNavigationStateChange
                            }
                            onMessage={handleMessage}
                            onError={() => {
                                setStatus("error");
                                setErrorMessage(
                                    "Could not load verification page.",
                                );
                            }}
                            onHttpError={() => {
                                setStatus("error");
                                setErrorMessage(
                                    "Verification page returned an error.",
                                );
                            }}
                            accessibilityLabel="Cloudflare Turnstile verification"
                        />
                    </View>
                ) : null}
            </DialogContent>
            <DialogFooter>
                <Button
                    className="h-[54px] min-h-[54px]"
                    variant="secondary"
                    onPress={handleClose}
                >
                    Cancel
                </Button>
                {showRetry ? (
                    <Button
                        className="h-[54px] min-h-[54px]"
                        onPress={resetChallenge}
                    >
                        Retry
                    </Button>
                ) : null}
            </DialogFooter>
        </Dialog>
    );
}

/**
 * Request a fresh Turnstile token immediately before a mutation.
 * Caller supplies an allowlisted action (auth_register | auth_recover).
 * Returns empty string when captcha is disabled (no site key).
 */
export function useTurnstileTokenRequest({
    placement = "center",
}: {
    placement?: "center" | "bottom";
} = {}) {
    const [open, setOpen] = useState(false);
    const [action, setAction] = useState<TurnstileAction>("auth_register");
    const resolverRef = useRef<((token: string | null) => void) | null>(null);

    const requestToken = useCallback(
        (nextAction: TurnstileAction): Promise<string | null> => {
            if (!isTurnstileConfigured()) {
                return Promise.resolve("");
            }
            return new Promise((resolve) => {
                resolverRef.current = resolve;
                setAction(nextAction);
                setOpen(true);
            });
        },
        [],
    );

    const handleToken = useCallback((token: string) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        resolve?.(token);
    }, []);

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next && resolverRef.current) {
            const resolve = resolverRef.current;
            resolverRef.current = null;
            resolve(null);
        }
    }, []);

    const dialog = (
        <TurnstileChallengeDialog
            open={open}
            onOpenChange={handleOpenChange}
            action={action}
            onToken={handleToken}
            placement={placement}
        />
    );

    return { requestToken, dialog };
}
