import * as React from "react";
import { AppState, Pressable, TextInput, View } from "react-native";
import { Dices, Eye, EyeOff } from "lucide-react-native";

import { useScrollFocusedInput } from "@/components/keyboard-scroll";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { colors, layout } from "@/theme";

type InputProps = React.ComponentProps<typeof TextInput> & {
    revealable?: boolean;
    invalid?: boolean;
    revealButtonHeight?: number;
    onGenerate?: () => void;
};

const minimumInputHeight = { minHeight: layout.minTouchTarget };
const generatorPadding = { paddingRight: 48 };
const generatorRevealPadding = { paddingRight: 96 };

const Input = React.forwardRef<TextInput, InputProps>(function Input(
    {
        className,
        placeholderTextColor,
        style,
        secureTextEntry,
        revealable = secureTextEntry === true,
        invalid = false,
        revealButtonHeight,
        onGenerate,
        onBlur,
        onFocus,
        onSelectionChange,
        ...props
    },
    forwardedRef,
) {
    const inputRef = React.useRef<TextInput>(null);
    const selectionRef = React.useRef({ start: 0, end: 0 });
    const [revealed, setRevealed] = React.useState(false);
    const scrollFocusedInput = useScrollFocusedInput();
    const hasGenerator = onGenerate !== undefined;
    const inputStyle = React.useMemo(
        () => [
            minimumInputHeight,
            style,
            hasGenerator
                ? revealable
                    ? generatorRevealPadding
                    : generatorPadding
                : undefined,
        ],
        [style, hasGenerator, revealable],
    );

    React.useImperativeHandle(
        forwardedRef,
        () => inputRef.current as TextInput,
    );

    React.useEffect(() => {
        if (!secureTextEntry) return;
        const subscription = AppState.addEventListener("change", (state) => {
            if (state !== "active") setRevealed(false);
        });
        return () => subscription.remove();
    }, [secureTextEntry]);

    const handleFocus = React.useCallback<NonNullable<InputProps["onFocus"]>>(
        (event) => {
            scrollFocusedInput(inputRef.current);
            onFocus?.(event);
        },
        [scrollFocusedInput, onFocus],
    );

    const handleBlur = React.useCallback<NonNullable<InputProps["onBlur"]>>(
        (event) => {
            setRevealed(false);
            onBlur?.(event);
        },
        [onBlur],
    );

    const handleSelectionChange = React.useCallback<
        NonNullable<InputProps["onSelectionChange"]>
    >(
        (event) => {
            selectionRef.current = event.nativeEvent.selection;
            onSelectionChange?.(event);
        },
        [onSelectionChange],
    );

    const toggleReveal = () => {
        const wasFocused = inputRef.current?.isFocused() ?? false;
        setRevealed((current) => !current);
        requestAnimationFrame(() => {
            if (!wasFocused) return;
            inputRef.current?.focus();
            inputRef.current?.setNativeProps({
                selection: selectionRef.current,
            });
        });
    };

    const textInput = (
        <TextInput
            ref={inputRef}
            className={cn(
                "w-full rounded-md border border-input bg-secondary/40 px-3 py-2.5 font-sans text-base leading-5 text-foreground",
                revealable && "pr-12",
                props.editable === false && "opacity-50",
                className,
                invalid && "border-primary",
            )}
            style={inputStyle}
            placeholderTextColor={placeholderTextColor ?? colors.muted}
            allowFontScaling
            maxFontSizeMultiplier={1.4}
            secureTextEntry={secureTextEntry && !revealed}
            aria-invalid={invalid}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onSelectionChange={handleSelectionChange}
            {...props}
        />
    );

    if (!revealable && !onGenerate) return textInput;

    const fieldName = String(
        props.accessibilityLabel ?? props.placeholder ?? "value",
    );
    return (
        <View className="relative w-full">
            {textInput}
            {onGenerate ? (
                <Pressable
                    className="absolute top-0 min-h-[48px] items-center justify-center"
                    style={{
                        width: 48,
                        right: revealable ? 48 : 0,
                        height: revealButtonHeight ?? 48,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Generate ${fieldName}`}
                    disabled={props.editable === false}
                    onPress={onGenerate}
                >
                    <Icon
                        as={Dices}
                        size={18}
                        className="text-muted-foreground"
                    />
                </Pressable>
            ) : null}
            {revealable ? (
                <Pressable
                    className={cn(
                        "absolute right-0 top-0 min-h-[44px] min-w-[44px] items-center justify-center",
                    )}
                    style={
                        revealButtonHeight
                            ? {
                                  height: revealButtonHeight,
                                  minHeight: 48,
                                  minWidth: 48,
                                  width: 48,
                              }
                            : undefined
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                        revealed ? `Hide ${fieldName}` : `Show ${fieldName}`
                    }
                    onPress={toggleReveal}
                >
                    <Icon
                        as={revealed ? EyeOff : Eye}
                        size={18}
                        className="text-muted-foreground"
                    />
                </Pressable>
            ) : null}
        </View>
    );
});

export { Input };
export type { InputProps };
