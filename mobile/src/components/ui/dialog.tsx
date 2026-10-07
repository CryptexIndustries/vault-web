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
import { Portal } from "@rn-primitives/portal";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { KeyboardScrollProvider } from "@/components/keyboard-scroll";
import { colors } from "@/theme";

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
    loadingLabel = "Loading…",
    scrollResetKey,
    bottomSheetVariant,
    children,
}: DialogProps) {
    const scrollRef = React.useRef<RNScrollView>(null);
    const sheetRef = React.useRef<ActionSheetRef>(null);
    const insets = useSafeAreaInsets();
    const window = useWindowDimensions();
    const reducedMotion = useReducedMotion();
    const portalName = React.useId();
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
    const open = openProp ?? uncontrolledOpen;
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
    const dismissibleRef = React.useRef(dismissible);
    dismissibleRef.current = dismissible;
    const availableHeight = window.height - insets.top - insets.bottom;
    const sheetBodyHeight = bottomSheetVariant
        ? deviceSheetBodyHeight(availableHeight, bottomSheetVariant)
        : Math.max(0, availableHeight);
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
                setDeviceModalVisible(true);
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
                }
            }
            return;
        }
        if (!sheet) return;
        if (open && !sheet.isOpen()) {
            sheet.show();
        } else if (!open && sheet.isOpen()) {
            sheet.hide();
        }
    }, [open, placement, deviceModal, prepareDeviceSheet]);

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
        if (openRef.current) handleOpenChange(false);
    }, [handleOpenChange, modal, deviceModal]);

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
            {children}
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
                {children}
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
            showsVerticalScrollIndicator={false}
            contentContainerClassName={bottomContentClassName}
        >
            <KeyboardScrollProvider scrollRef={scrollRef}>
                {children}
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
                    containerStyle={
                        deviceSheet
                            ? deviceSheetPresentation.containerStyle
                            : {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                  borderTopWidth: 1,
                                  borderLeftWidth: 1,
                                  borderRightWidth: 1,
                                  borderTopLeftRadius: 12,
                                  borderTopRightRadius: 12,
                              }
                    }
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
                                  accessibilityLabel: "Close dialog",
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
                              : () => handleOpenChange(false)
                    }
                    onClose={handleSheetClose}
                >
                    <View
                        role="dialog"
                        accessibilityViewIsModal
                        className="max-h-full"
                        style={[
                            loading ? { minHeight: 220 } : undefined,
                            deviceSheet
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
                            style={fullHeight ? { flex: 1 } : { flexShrink: 1 }}
                        >
                            {bottomBody}
                        </View>
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
                    visible={open}
                    transparent
                    animationType={reducedMotion ? "none" : "fade"}
                    onRequestClose={() => handleOpenChange(false)}
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
                                    accessibilityLabel="Close dialog"
                                />
                            ) : (
                                <View className="absolute inset-0" />
                            )}
                            <View className="z-10 max-h-full w-full max-w-sm overflow-hidden rounded-lg border border-border bg-background">
                                {centerBody}
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
                            accessibilityLabel="Opening…"
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
};
export type { DialogContentProps, DialogProps };
