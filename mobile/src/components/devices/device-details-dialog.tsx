import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    useTransition,
    type ReactNode,
} from "react";
import {
    AccessibilityInfo,
    Animated,
    BackHandler,
    Easing,
    Keyboard,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import ActionSheet, { type ActionSheetRef } from "react-native-actions-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Portal } from "@rn-primitives/portal";
import { ReduceMotion } from "react-native-reanimated";
import { Dialog, DialogContext } from "@/components/ui/dialog";
import {
    deviceSheetBodyHeight,
    deviceSheetPresentation,
    type DeviceSheetVariant,
} from "@/components/ui/device-sheet-presentation";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

type DeviceDetailsDialogProps = {
    open: boolean;
    active: boolean;
    preload: boolean;
    dismissible: boolean;
    bottomSheetVariant: DeviceSheetVariant;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
};

export function DeviceDetailsDialog(props: DeviceDetailsDialogProps) {
    const [screenReader, setScreenReader] = useState<boolean | null>(null);
    const [retained, setRetained] = useState(false);
    const [presented, setPresented] = useState(false);
    useEffect(() => {
        let mounted = true;
        void AccessibilityInfo.isScreenReaderEnabled()
            .then((enabled) => {
                if (mounted) setScreenReader(enabled);
            })
            .catch(() => {});
        const listener = AccessibilityInfo.addEventListener(
            "screenReaderChanged",
            setScreenReader,
        );
        return () => {
            mounted = false;
            listener.remove();
        };
    }, []);
    useEffect(() => {
        if (!props.open && !presented) setRetained(screenReader === false);
    }, [props.open, presented, screenReader]);
    if (!retained) {
        return (
            <Dialog
                open={props.active && props.open}
                placement="bottom"
                bottomSheetVariant={props.bottomSheetVariant}
                dismissible={props.dismissible}
                onOpenChange={props.onOpenChange}
            >
                {props.children}
            </Dialog>
        );
    }
    return (
        <RetainedDeviceDetails {...props} onPresentedChange={setPresented} />
    );
}

function RetainedDeviceDetails({
    open,
    active,
    preload,
    dismissible,
    bottomSheetVariant,
    onOpenChange,
    onPresentedChange,
    children,
}: DeviceDetailsDialogProps & {
    onPresentedChange: (presented: boolean) => void;
}) {
    const portalName = useId();
    const sheetRef = useRef<ActionSheetRef>(null);
    const mounted = useRef(false);
    const [ready, setReady] = useState(false);
    const [sheetRevision, setSheetRevision] = useState(0);
    const [attached, setAttached] = useState(false);
    const [presented, setPresented] = useState(false);
    const [keyboardActive, setKeyboardActive] = useState(false);
    const wasOpen = useRef(false);
    const position = useRef(0);
    const backdropClosed = useRef(true);
    const [, prepare] = useTransition();
    const reducedMotion = useReducedMotion();
    const insets = useSafeAreaInsets();
    const window = useWindowDimensions();
    const presentation = deviceSheetPresentation.variants[bottomSheetVariant];
    const requestedOpen = active && open;
    const latest = useRef({ requestedOpen, dismissible, onOpenChange });
    latest.current = { requestedOpen, dismissible, onOpenChange };
    const backdropRef = useRef<Animated.Value | null>(null);
    if (!backdropRef.current) backdropRef.current = new Animated.Value(0);
    const backdrop = backdropRef.current;
    const bodyHeight = deviceSheetBodyHeight(
        window.height - insets.top - insets.bottom,
        bottomSheetVariant,
    );
    const visible = active && (requestedOpen || presented);
    const attachSheet = useCallback((sheet: ActionSheetRef | null) => {
        sheetRef.current = sheet;
        if (sheet) {
            setAttached(true);
        }
    }, []);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const finishClosing = useCallback(() => {
        if (
            !latest.current.requestedOpen &&
            position.current === 0 &&
            backdropClosed.current
        ) {
            setPresented(false);
        }
    }, []);
    const sheetClosed = useCallback(() => {
        if (!mounted.current) return;
        position.current = 0;
        finishClosing();
        setReady(false);
        setSheetRevision((current) => current + 1);
    }, [finishClosing]);

    const requestClose = useCallback(() => {
        const current = latest.current;
        if (current.requestedOpen && current.dismissible) {
            current.onOpenChange(false);
        }
    }, []);
    const snapChanged = useCallback((index: number) => {
        const current = latest.current;
        if (index !== 0 || !current.requestedOpen) return;
        if (current.dismissible) current.onOpenChange(false);
        else sheetRef.current?.snapToIndex(1);
    }, []);
    const positionChanged = useCallback(
        (percentage: number) => {
            position.current = percentage;
            finishClosing();
        },
        [finishClosing],
    );

    useEffect(() => {
        onPresentedChange(requestedOpen || presented);
    }, [requestedOpen, presented, onPresentedChange]);

    useEffect(() => {
        if (wasOpen.current && !requestedOpen) Keyboard.dismiss();
        wasOpen.current = requestedOpen;
    }, [requestedOpen]);

    useEffect(() => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        if (requestedOpen) {
            setPresented(true);
            setKeyboardActive(true);
            if (!sheet.isOpen()) sheet.show(1);
            else if (ready) sheet.snapToIndex(1);
        } else if (sheet.isOpen()) {
            if (ready && sheet.currentSnapIndex() !== 0) {
                sheet.snapToIndex(0);
            }
        } else if (active && preload) {
            prepare(() => sheet.show(0));
        }
    }, [
        requestedOpen,
        active,
        preload,
        ready,
        attached,
        sheetRevision,
        prepare,
    ]);

    useEffect(() => {
        if (
            !active ||
            (!requestedOpen && !presented && !Keyboard.isVisible())
        ) {
            setKeyboardActive(false);
        }
        if (!active || (!requestedOpen && !keyboardActive)) return;
        const listener = Keyboard.addListener("keyboardDidHide", () => {
            if (!latest.current.requestedOpen) setKeyboardActive(false);
        });
        return () => listener.remove();
    }, [active, requestedOpen, presented, keyboardActive]);

    useEffect(() => {
        if (!requestedOpen) return;
        const listener = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                requestClose();
                return true;
            },
        );
        return () => listener.remove();
    }, [requestedOpen, requestClose]);

    useEffect(() => {
        backdrop.stopAnimation();
        const target = requestedOpen
            ? deviceSheetPresentation.backdropOpacity
            : 0;
        backdropClosed.current = false;
        if (reducedMotion || !active) {
            backdrop.setValue(target);
            backdropClosed.current = target === 0;
            finishClosing();
            return;
        }
        const animation = Animated.timing(backdrop, {
            toValue: target,
            duration: deviceSheetPresentation.backdropDuration,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (!finished || latest.current.requestedOpen) return;
            backdropClosed.current = target === 0;
            finishClosing();
        });
        return () => animation.stop();
    }, [requestedOpen, active, reducedMotion, backdrop, finishClosing]);

    return (
        <Portal name={portalName}>
            <View
                testID="device-details-retained-host"
                style={[StyleSheet.absoluteFill, { opacity: active ? 1 : 0 }]}
                pointerEvents={visible ? "auto" : "none"}
                accessibilityElementsHidden={!requestedOpen}
                importantForAccessibility={
                    requestedOpen ? "auto" : "no-hide-descendants"
                }
            >
                <Animated.View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor:
                                deviceSheetPresentation.backdropColor,
                            opacity: backdrop,
                        },
                    ]}
                />
                {visible ? (
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        accessibilityRole="button"
                        accessibilityLabel="Close dialog"
                        onPress={requestClose}
                    />
                ) : null}
                <View
                    style={StyleSheet.absoluteFill}
                    pointerEvents={requestedOpen ? "box-none" : "none"}
                >
                    {/* animated=false skips vendor swipe callbacks. ReduceMotion controls the spring. */}
                    <ActionSheet
                        ref={attachSheet}
                        isModal={false}
                        backgroundInteractionEnabled
                        snapPoints={[0, 100]}
                        initialSnapIndex={0}
                        closable={false}
                        closeOnPressBack={false}
                        closeOnTouchBackdrop={false}
                        onRequestClose={() => false}
                        gestureEnabled={requestedOpen && dismissible}
                        keyboardHandlerEnabled={
                            active && (requestedOpen || keyboardActive)
                        }
                        enableGesturesInScrollView
                        animated
                        openAnimationConfig={{
                            ...deviceSheetPresentation.openAnimation,
                            reduceMotion: reducedMotion
                                ? ReduceMotion.Always
                                : ReduceMotion.Never,
                        }}
                        defaultOverlayOpacity={0}
                        drawUnderStatusBar={false}
                        useBottomSafeAreaPadding
                        containerStyle={deviceSheetPresentation.containerStyle}
                        indicatorStyle={{
                            ...deviceSheetPresentation.indicatorStyle,
                            marginBottom: presentation.indicatorMarginBottom,
                        }}
                        onOpen={() => setReady(true)}
                        onClose={sheetClosed}
                        onSnapIndexChange={snapChanged}
                        onChange={positionChanged}
                    >
                        <View
                            role="dialog"
                            accessibilityViewIsModal
                            style={{ maxHeight: bodyHeight, flexShrink: 1 }}
                        >
                            <DialogContext.Provider
                                value={{
                                    open: requestedOpen,
                                    onOpenChange,
                                    placement: "bottom",
                                }}
                            >
                                <View
                                    className={presentation.contentClassName}
                                    style={{ flexShrink: 1, minHeight: 0 }}
                                >
                                    {children}
                                </View>
                            </DialogContext.Provider>
                        </View>
                    </ActionSheet>
                </View>
            </View>
        </Portal>
    );
}
