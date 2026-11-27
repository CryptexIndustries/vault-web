import * as React from "react";
import {
    ActivityIndicator,
    Animated,
    Easing,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView as RNScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
    type ViewProps,
} from "react-native";
import ActionSheet, {
    ScrollView as ActionSheetScrollView,
    type ActionSheetRef,
} from "react-native-actions-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLingui } from "@lingui/react/macro";
import { Portal } from "@rn-primitives/portal";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { cn } from "@/lib/utils";
import { vaultLog } from "@/utils/logging";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { KeyboardScrollProvider } from "@/components/keyboard-scroll";
import { colors, isTabletViewport, layout } from "@/theme";

import { Text, type TextProps } from "./text";
import {
    deviceSheetBodyHeight,
    deviceSheetPresentation,
    type DeviceSheetVariant,
} from "./device-sheet-presentation";

type DialogContextValue = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    placement: "center" | "bottom";
};

export const DialogContext = React.createContext<DialogContextValue | null>(
    null,
);

// On iOS a native modal that opens while another is on screen or still
// closing never appears, so top-level dialogs there show one at a time.
// Each presentation gets its own token, so a late dismissal can only release
// the presentation it belongs to.
const shownModals = new Set<object>();
const modalsWaitingToShow = new Set<() => void>();

/** A dialog's presentation on screen, and those still closing, oldest first. */
type Presentations = { shown: object | null; closing: object[] };

function showModal(own: React.RefObject<Presentations>, show: () => void) {
    const attempt = () => {
        const token = {};
        shownModals.add(token);
        own.current.shown = token;
        show();
    };
    if (shownModals.size === 0) return attempt();
    modalsWaitingToShow.add(attempt);
    return () => {
        modalsWaitingToShow.delete(attempt);
    };
}

// A dismissal that is never reported must not block every later dialog.
const dismissalTimers = new Map<object, ReturnType<typeof setTimeout>>();

function awaitDismissal(own: React.RefObject<Presentations>) {
    const token = own.current.shown;
    if (!token) return;
    own.current.shown = null;
    own.current.closing.push(token);
    const timer = setTimeout(() => {
        vaultLog.warn("Dialog dismissal was not reported; showing the next");
        modalHidden(token);
    }, 2000);
    dismissalTimers.set(token, timer);
}

// iOS reports one modal's dismissals in order.
function modalDismissed(own: React.RefObject<Presentations>) {
    modalHidden(own.current.closing.shift());
}

function modalHidden(token: object | null | undefined) {
    if (!token) return;
    clearTimeout(dismissalTimers.get(token));
    dismissalTimers.delete(token);
    if (!shownModals.delete(token) || shownModals.size > 0) return;
    const [next] = modalsWaitingToShow;
    if (!next) return;
    modalsWaitingToShow.delete(next);
    next();
}

// A dialog inside a native one presents above it, so it never waits.
const InsideModalContext = React.createContext(false);

// While the SSH agent approval is up, app dialogs hide but keep their open
// state, so nothing covers the prompt or makes it drop touches.
let dialogsHidden = 0;
const hiddenListeners = new Set<() => void>();
const subscribeHidden = (listener: () => void) => {
    hiddenListeners.add(listener);
    return () => {
        hiddenListeners.delete(listener);
    };
};

function hideDialogs() {
    dialogsHidden++;
    hiddenListeners.forEach((listener) => listener());
    return () => {
        dialogsHidden--;
        hiddenListeners.forEach((listener) => listener());
    };
}

function useDialog() {
    const ctx = React.useContext(DialogContext);
    if (!ctx) throw new Error("Dialog components must be used within Dialog");
    return ctx;
}

type DialogProps = {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** When true, backdrop / back cannot dismiss (e.g. secret reveal). */
    dismissible?: boolean;
    /** Scroll long forms inside the sheet. */
    scroll?: boolean;
    /** Fill the available screen height for recovery reveal / acknowledgement. */
    fullHeight?: boolean;
    /** Opt into the mobile drawer treatment used by task flows. */
    placement?: "center" | "bottom";
    /** Bottom sheets can opt out of a native window to release closing gestures. */
    modal?: boolean;
    /** Block the sheet content while its data is being refreshed. */
    loading?: boolean;
    loadingLabel?: string;
    /** Start a different sheet view at the top of its content. */
    scrollResetKey?: string;
    bottomSheetVariant?: DeviceSheetVariant;
    /** Fixed content inside the native dialog, outside scrolling content. */
    footer?: React.ReactNode;
    children: React.ReactNode;
};

function Dialog({
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    dismissible = true,
    scroll = false,
    fullHeight = false,
    placement = "center",
    modal = true,
    loading = false,
    loadingLabel: loadingLabelProp,
    scrollResetKey,
    bottomSheetVariant,
    footer,
    children,
}: DialogProps) {
    const { t } = useLingui();
    const loadingLabel = loadingLabelProp ?? t`Loading…`;
    const scrollRef = React.useRef<RNScrollView>(null);
    const sheetRef = React.useRef<ActionSheetRef>(null);
    const presentations = React.useRef<Presentations>({
        shown: null,
        closing: [],
    });
    const insets = useSafeAreaInsets();
    const window = useWindowDimensions();
    const reducedMotion = useReducedMotion();
    const portalName = React.useId();
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
    const hidden = React.useSyncExternalStore(
        subscribeHidden,
        () => dialogsHidden > 0,
    );
    const open = (openProp ?? uncontrolledOpen) && !hidden;
    const insideModal = React.useContext(InsideModalContext);
    const nativeModal = placement === "center" || modal;
    const waitsForModals = Platform.OS === "ios" && nativeModal && !insideModal;
    const [centerShown, setCenterShown] = React.useState(false);
    const centerVisible = open && (centerShown || !waitsForModals);
    const centerOnScreen = React.useRef(false);
    const deviceSheet = bottomSheetVariant !== undefined;
    const devicePresentation = bottomSheetVariant
        ? deviceSheetPresentation.variants[bottomSheetVariant]
        : undefined;
    const deviceModal = deviceSheet && placement === "bottom" && modal;
    const [deviceModalVisible, setDeviceModalVisible] = React.useState(false);
    const deviceModalReady = React.useRef(false);
    const deviceBackdropRef = React.useRef<Animated.Value | null>(null);
    if (!deviceBackdropRef.current) {
        deviceBackdropRef.current = new Animated.Value(0);
    }
    const deviceBackdrop = deviceBackdropRef.current;
    const [preparingDeviceSheet, prepareDeviceSheet] = React.useTransition();
    const closingDeviceModal = React.useRef(false);
    // A close this Dialog started, to close or hide, is not a user dismissal.
    const closingSheet = React.useRef(false);
    const [sheetReopens, reopenSheet] = React.useReducer(
        (count: number) => count + 1,
        0,
    );
    const dismissibleRef = React.useRef(dismissible);
    dismissibleRef.current = dismissible;
    const availableHeight = window.height - insets.top - insets.bottom;
    const sheetBodyHeight = bottomSheetVariant
        ? deviceSheetBodyHeight(availableHeight, bottomSheetVariant)
        : Math.max(0, availableHeight);
    // Bottom sheets keep a form-sheet width on tablets instead of spanning the screen.
    const sheetWidth = isTabletViewport(window.width, window.height)
        ? Math.min(window.width, layout.panelMaxWidth)
        : undefined;
    const bottomContentClassName =
        devicePresentation?.contentClassName ?? "gap-3 px-6 pb-5 pt-3";

    const handleOpenChange = React.useCallback(
        (next: boolean) => {
            if (!next && !dismissible) return;
            if (openProp === undefined) setUncontrolledOpen(next);
            onOpenChange?.(next);
        },
        [dismissible, onOpenChange, openProp],
    );

    const openChangeRef = React.useRef(handleOpenChange);
    openChangeRef.current = handleOpenChange;
    const openRef = React.useRef(open);
    openRef.current = open;
    const requestDeviceClose = React.useCallback(
        () => dismissibleRef.current,
        [],
    );
    const beforeDeviceClose = React.useCallback(() => {
        closingDeviceModal.current = true;
        if (openRef.current) openChangeRef.current(false);
    }, []);

    React.useEffect(() => {
        deviceBackdrop.stopAnimation();
        if (!deviceModal || !deviceModalVisible) {
            deviceBackdrop.setValue(0);
            return;
        }
        const opacity = open ? deviceSheetPresentation.backdropOpacity : 0;
        if (reducedMotion) {
            deviceBackdrop.setValue(opacity);
            return;
        }
        const animation = Animated.timing(deviceBackdrop, {
            toValue: opacity,
            duration: deviceSheetPresentation.backdropDuration,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [deviceModal, deviceModalVisible, open, reducedMotion, deviceBackdrop]);

    React.useEffect(() => {
        if (placement !== "bottom") return;
        const sheet = sheetRef.current;
        if (deviceModal) {
            if (open) {
                closingDeviceModal.current = false;
                if (!deviceModalVisible) {
                    const show = () => setDeviceModalVisible(true);
                    return waitsForModals
                        ? showModal(presentations, show)
                        : show();
                }
                if (deviceModalReady.current && sheet && !sheet.isOpen()) {
                    prepareDeviceSheet(() => sheet.show());
                }
            } else {
                closingDeviceModal.current = true;
                if (sheet?.isOpen()) {
                    sheet.hide();
                } else {
                    deviceModalReady.current = false;
                    setDeviceModalVisible(false);
                    awaitDismissal(presentations);
                }
            }
            return;
        }
        if (!sheet) return;
        if (open && !sheet.isOpen()) {
            const show = () => sheet.show();
            return waitsForModals ? showModal(presentations, show) : show();
        } else if (!open && sheet.isOpen()) {
            closingSheet.current = true;
            sheet.hide();
        }
    }, [
        open,
        placement,
        deviceModal,
        deviceModalVisible,
        waitsForModals,
        prepareDeviceSheet,
        sheetReopens,
    ]);

    React.useEffect(() => {
        if (placement !== "center" || !waitsForModals) return;
        if (open) return showModal(presentations, () => setCenterShown(true));
        setCenterShown(false);
        // Only a modal that reached the screen reports its dismissal.
        if (centerOnScreen.current) awaitDismissal(presentations);
        else {
            modalHidden(presentations.current.shown);
            presentations.current.shown = null;
        }
        centerOnScreen.current = false;
    }, [open, placement, waitsForModals]);

    React.useLayoutEffect(() => {
        if (centerVisible) centerOnScreen.current = true;
    }, [centerVisible]);

    React.useEffect(() => {
        const own = presentations.current;
        return () => {
            modalHidden(own.shown);
            own.closing.forEach(modalHidden);
        };
    }, []);

    React.useEffect(() => {
        if (!open || !scroll || scrollResetKey === undefined) return;
        const frame = requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: 0, animated: false });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, scroll, scrollResetKey]);

    const handleSheetClose = React.useCallback(() => {
        if (deviceModal) {
            if (openRef.current && !closingDeviceModal.current) {
                requestAnimationFrame(() => {
                    if (openRef.current) sheetRef.current?.show();
                });
            } else {
                deviceModalReady.current = false;
                setDeviceModalVisible(false);
                awaitDismissal(presentations);
            }
            return;
        }
        if (!modal) {
            // A new open request can arrive while the closing animation finishes.
            if (openRef.current) {
                requestAnimationFrame(() => {
                    if (openRef.current) sheetRef.current?.show();
                });
            }
            return;
        }
        // Its native window is still closing; onDismiss frees the turn.
        awaitDismissal(presentations);
        const closedHere = closingSheet.current;
        closingSheet.current = false;
        if (!openRef.current) return;
        // Opened again while that close was still animating.
        if (closedHere) reopenSheet();
        else handleOpenChange(false);
    }, [handleOpenChange, modal, deviceModal]);

    const fixedFooter = footer ? (
        <View
            testID="dialog-footer"
            style={{ flexShrink: 0 }}
            pointerEvents={loading ? "none" : "auto"}
            accessibilityElementsHidden={loading}
            importantForAccessibility={loading ? "no-hide-descendants" : "auto"}
        >
            {footer}
        </View>
    ) : null;

    const content = (
        <InsideModalContext.Provider value={nativeModal}>
            {children}
        </InsideModalContext.Provider>
    );

    const staticBody = (
        <View
            style={
                deviceSheet
                    ? fullHeight
                        ? { flex: 1, minHeight: 0 }
                        : { flexShrink: 1, minHeight: 0 }
                    : undefined
            }
            className={
                placement === "bottom" ? bottomContentClassName : "gap-3 p-4"
            }
        >
            {content}
        </View>
    );

    const centerBody = scroll ? (
        <RNScrollView
            ref={scrollRef}
            className="max-h-[100%]"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerClassName="gap-3 p-4"
        >
            <KeyboardScrollProvider scrollRef={scrollRef}>
                {content}
            </KeyboardScrollProvider>
        </RNScrollView>
    ) : (
        staticBody
    );

    const bottomBody = scroll ? (
        <ActionSheetScrollView
            ref={scrollRef}
            style={fullHeight ? { flex: 1 } : { flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            // The sheet turns scrolling off mid-drag to take over a pull at
            // the top. Android then never releases its overscroll stretch,
            // and the next tap only catches it instead of reaching the content.
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            contentContainerClassName={bottomContentClassName}
        >
            <KeyboardScrollProvider scrollRef={scrollRef}>
                {content}
            </KeyboardScrollProvider>
        </ActionSheetScrollView>
    ) : (
        staticBody
    );

    const dialog = (
        <DialogContext.Provider
            value={{ open, onOpenChange: handleOpenChange, placement }}
        >
            {placement === "bottom" ? (
                <ActionSheet
                    ref={sheetRef}
                    isModal={deviceModal ? false : modal}
                    animated={!reducedMotion}
                    openAnimationConfig={
                        deviceSheet
                            ? deviceSheetPresentation.openAnimation
                            : undefined
                    }
                    gestureEnabled
                    closable={dismissible}
                    closeOnPressBack={deviceModal ? false : dismissible}
                    closeOnTouchBackdrop={dismissible}
                    keyboardHandlerEnabled
                    enableGesturesInScrollView
                    defaultOverlayOpacity={
                        deviceModal
                            ? 0
                            : deviceSheet
                              ? deviceSheetPresentation.backdropOpacity
                              : 0.6
                    }
                    overlayColor={
                        deviceSheet
                            ? deviceSheetPresentation.backdropColor
                            : "black"
                    }
                    drawUnderStatusBar={false}
                    useBottomSafeAreaPadding
                    containerStyle={{
                        ...(deviceSheet
                            ? deviceSheetPresentation.containerStyle
                            : {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                  borderTopWidth: 1,
                                  borderLeftWidth: 1,
                                  borderRightWidth: 1,
                                  borderTopLeftRadius: 12,
                                  borderTopRightRadius: 12,
                              }),
                        // An undefined width would replace the sheet's own 100% default.
                        ...(sheetWidth && { width: sheetWidth }),
                    }}
                    indicatorStyle={
                        devicePresentation
                            ? {
                                  ...deviceSheetPresentation.indicatorStyle,
                                  marginBottom:
                                      devicePresentation.indicatorMarginBottom,
                              }
                            : {
                                  width: 32,
                                  height: 4,
                                  marginTop: 12,
                                  marginBottom: 0,
                                  backgroundColor: colors.muted,
                              }
                    }
                    backdropProps={
                        dismissible
                            ? {
                                  accessibilityRole: "button",
                                  accessibilityLabel: t`Close dialog`,
                              }
                            : {
                                  accessible: false,
                                  importantForAccessibility: "no",
                              }
                    }
                    onRequestClose={
                        deviceModal ? requestDeviceClose : () => dismissible
                    }
                    onBeforeClose={
                        deviceModal
                            ? beforeDeviceClose
                            : modal
                              ? undefined
                              : () => {
                                    if (openRef.current)
                                        handleOpenChange(false);
                                }
                    }
                    onClose={handleSheetClose}
                    onDismiss={() => modalDismissed(presentations)}
                >
                    <View
                        role="dialog"
                        accessibilityViewIsModal
                        className="max-h-full"
                        style={[
                            loading ? { minHeight: 220 } : undefined,
                            deviceSheet || footer
                                ? { maxHeight: sheetBodyHeight }
                                : undefined,
                            fullHeight
                                ? {
                                      height: sheetBodyHeight,
                                  }
                                : undefined,
                        ]}
                    >
                        <View
                            pointerEvents={loading ? "none" : "auto"}
                            accessibilityElementsHidden={loading}
                            importantForAccessibility={
                                loading ? "no-hide-descendants" : "auto"
                            }
                            style={
                                fullHeight
                                    ? { flex: 1, minHeight: 0 }
                                    : { flexShrink: 1, minHeight: 0 }
                            }
                        >
                            {bottomBody}
                        </View>
                        {fixedFooter}
                        {loading ? (
                            <View
                                accessibilityRole="progressbar"
                                accessibilityLabel={loadingLabel}
                                accessibilityLiveRegion="polite"
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        zIndex: 1,
                                        backgroundColor: "rgba(24,29,43,0.94)",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 14,
                                        minHeight: 160,
                                    },
                                ]}
                            >
                                <ActivityIndicator
                                    size="large"
                                    color={colors.primary}
                                />
                                <Text
                                    style={{
                                        color: colors.muted,
                                        fontSize: 13,
                                    }}
                                >
                                    {loadingLabel}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                </ActionSheet>
            ) : (
                <Modal
                    visible={centerVisible}
                    transparent
                    animationType={reducedMotion ? "none" : "fade"}
                    onRequestClose={() => handleOpenChange(false)}
                    onDismiss={() => modalDismissed(presentations)}
                    statusBarTranslucent
                >
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                    >
                        <View className="flex-1 items-center justify-center bg-black/60 p-4">
                            {dismissible ? (
                                <Pressable
                                    className="absolute inset-0"
                                    onPress={() => handleOpenChange(false)}
                                    accessibilityRole="button"
                                    accessibilityLabel={t`Close dialog`}
                                />
                            ) : (
                                <View className="absolute inset-0" />
                            )}
                            <View
                                className="z-10 max-h-full w-full max-w-sm overflow-hidden rounded-lg border border-border bg-background"
                                style={
                                    footer
                                        ? { maxHeight: availableHeight }
                                        : undefined
                                }
                            >
                                {footer ? (
                                    <View
                                        style={{ flexShrink: 1, minHeight: 0 }}
                                    >
                                        {centerBody}
                                    </View>
                                ) : (
                                    centerBody
                                )}
                                {fixedFooter}
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            )}
        </DialogContext.Provider>
    );

    if (deviceModal) {
        return (
            <Modal
                testID="devices-dialog-modal"
                visible={deviceModalVisible}
                transparent
                animationType="none"
                statusBarTranslucent
                navigationBarTranslucent
                supportedOrientations={[
                    "portrait",
                    "portrait-upside-down",
                    "landscape",
                    "landscape-left",
                    "landscape-right",
                ]}
                onRequestClose={() => handleOpenChange(false)}
                onDismiss={() => modalDismissed(presentations)}
                onShow={() => {
                    if (!openRef.current) return;
                    deviceModalReady.current = true;
                    if (!sheetRef.current?.isOpen()) {
                        prepareDeviceSheet(() => sheetRef.current?.show());
                    }
                }}
            >
                <GestureHandlerRootView style={{ flex: 1 }}>
                    <Animated.View
                        testID="devices-dialog-backdrop"
                        pointerEvents="none"
                        accessible={false}
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                backgroundColor:
                                    deviceSheetPresentation.backdropColor,
                                opacity: deviceBackdrop,
                            },
                        ]}
                    />
                    {dialog}
                    {open && preparingDeviceSheet ? (
                        <View
                            accessibilityRole="progressbar"
                            accessibilityLabel={t`Opening…`}
                            accessibilityLiveRegion="polite"
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    alignItems: "center",
                                    justifyContent: "center",
                                },
                            ]}
                        >
                            <ActivityIndicator color={colors.primary} />
                        </View>
                    ) : null}
                </GestureHandlerRootView>
            </Modal>
        );
    }
    if (placement === "bottom" && !modal) {
        return (
            <Portal name={portalName}>
                <View
                    style={StyleSheet.absoluteFill}
                    pointerEvents={open ? "auto" : "none"}
                    accessibilityViewIsModal={open}
                    importantForAccessibility={
                        open ? "yes" : "no-hide-descendants"
                    }
                >
                    {dialog}
                </View>
            </Portal>
        );
    }
    return dialog;
}

type DialogContentProps = ViewProps;

function DialogContent({ className, ...props }: DialogContentProps) {
    return <View className={cn("gap-2", className)} {...props} />;
}

function DialogHeader({ className, ...props }: ViewProps) {
    return <View className={cn("flex-col gap-1.5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: ViewProps) {
    const { placement } = useDialog();
    return (
        <View
            className={cn(
                "mt-1 gap-2",
                placement === "bottom"
                    ? "flex-col items-stretch"
                    : "flex-row items-center justify-end",
                className,
            )}
            {...props}
        />
    );
}

function DialogTitle({ className, ...props }: TextProps) {
    const { placement } = useDialog();
    return (
        <Text
            role="heading"
            aria-level={2}
            className={cn(
                placement === "bottom"
                    ? "text-2xl font-semibold leading-8 tracking-[-0.6px]"
                    : "text-lg font-semibold leading-none",
                className,
            )}
            {...props}
        />
    );
}

function DialogDescription({ className, ...props }: TextProps) {
    return (
        <Text
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    hideDialogs,
};
export type { DialogContentProps, DialogProps };
