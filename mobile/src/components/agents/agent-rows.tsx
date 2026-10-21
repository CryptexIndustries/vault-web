import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Check, ChevronRight, FileKey, SquareTerminal } from "lucide-react-native";
import type { AgentKeyOption } from "@cryptex-industries/vault-core/agent/agent-format";

import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

/** The terminal glyph of a connected agent, in the agent tint. */
export function AgentGlyph({ variant = "list" }: { variant?: "list" | "identity" }) {
    const identity = variant === "identity";
    return (
        <View
            style={{
                width: identity ? 48 : 36,
                height: identity ? 48 : 36,
                borderRadius: identity ? 12 : 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: identity ? colors.secondary : colors.agentTint,
                borderWidth: identity ? 1 : 0,
                borderColor: colors.border,
            }}
        >
            <SquareTerminal
                size={identity ? 22 : 18}
                color={colors.agent}
                strokeWidth={1.7}
            />
        </View>
    );
}

/** Uppercase section label with an optional count or action on the right. */
export function AgentSectionLabel({
    title,
    right,
    style,
}: {
    title: string;
    right?: ReactNode;
    style?: object;
}) {
    return (
        <View
            style={[
                {
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    minHeight: 32,
                    marginTop: 18,
                },
                style,
            ]}
        >
            <Text
                style={{
                    fontSize: 11,
                    letterSpacing: 1,
                    color: colors.muted,
                }}
            >
                {title.toUpperCase()}
            </Text>
            {typeof right === "string" ? (
                <Text style={{ fontSize: 11, color: colors.muted }}>{right}</Text>
            ) : (
                right
            )}
        </View>
    );
}

/** An agent in the Devices list, styled like the device rows above it. */
export function AgentRow({
    id,
    name,
    subtitle,
    disabled,
    onPress,
}: {
    id: string;
    name: string;
    subtitle: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            testID={`agent-row-${id}`}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${subtitle}`}
            disabled={disabled}
            onPress={onPress}
            android_ripple={{ color: colors.border }}
            style={{
                minHeight: 72,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <AgentGlyph />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 16 }}>
                    {name}
                </Text>
                <Text
                    numberOfLines={1}
                    style={{ fontSize: 11, lineHeight: 14, color: colors.muted }}
                >
                    {subtitle}
                </Text>
            </View>
            <ChevronRight size={16} color={colors.muted} />
        </Pressable>
    );
}

/** The vault list's round key icon, with the key's name and fingerprint. */
function KeyBody({ name, detail }: { name: string; detail: string }) {
    return (
        <>
            <View
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.secondary,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.03)",
                }}
            >
                <FileKey size={17} color={colors.primary} strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14 }}>
                    {name}
                </Text>
                <Text
                    numberOfLines={1}
                    className="font-mono"
                    style={{ fontSize: 11.5, color: colors.muted, marginTop: 4 }}
                >
                    {detail}
                </Text>
            </View>
        </>
    );
}

/**
 * The keys an agent may use: flat vault-list rows that toggle on tap, each
 * with a trailing check circle. Never a checkbox or switch.
 */
export function KeyPicker({
    keys,
    selected,
    onChange,
    disabled,
}: {
    keys: readonly AgentKeyOption[];
    selected: readonly string[];
    onChange: (update: (selected: string[]) => string[]) => void;
    disabled?: boolean;
}) {
    return keys.map((key) => {
        const checked = selected.includes(key.id);
        return (
            <Pressable
                key={key.id}
                testID={`agent-key-${key.fingerprint}`}
                accessibilityRole="checkbox"
                accessibilityLabel={`${key.name}, ${key.detail}`}
                accessibilityState={{ checked, disabled }}
                disabled={disabled}
                onPress={() =>
                    onChange((current) =>
                        current.includes(key.id)
                            ? current.filter((id) => id !== key.id)
                            : [...current, key.id],
                    )
                }
                android_ripple={{ color: colors.border }}
                style={{
                    minHeight: 68,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    opacity: disabled ? 0.5 : 1,
                }}
            >
                <KeyBody name={key.name} detail={key.detail} />
                <View
                    style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: 1.6,
                        borderColor: checked ? colors.primary : colors.trackOff,
                        backgroundColor: checked ? colors.primary : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    {checked ? (
                        <Check size={14} color={colors.navigation} strokeWidth={3} />
                    ) : null}
                </View>
            </Pressable>
        );
    });
}

/** A plain key row for read-only lists (agent page). */
export function KeyRow({ name, detail }: { name: string; detail: string }) {
    return (
        <View
            style={{
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <KeyBody name={name} detail={detail} />
        </View>
    );
}

/** A label and value card, like CopyableField without the copy action. */
export function InfoCard({
    label,
    value,
    note,
    badge,
    monospace,
}: {
    label: string;
    value: string;
    note?: string;
    badge?: ReactNode;
    monospace?: boolean;
}) {
    return (
        <View className="mb-3 rounded-lg border border-border bg-secondary px-4 py-3">
            <Text className="text-xs text-muted-foreground">{label}</Text>
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 6,
                    flexWrap: "wrap",
                }}
            >
                <Text
                    className={monospace ? "font-mono" : undefined}
                    style={{ fontSize: 14, flexShrink: 1 }}
                    selectable
                >
                    {value}
                </Text>
                {badge}
            </View>
            {note ? (
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 4 }}>
                    {note}
                </Text>
            ) : null}
        </View>
    );
}

/** A single-choice row with the 18 px ring. */
export function RadioRow({
    testID,
    label,
    selected,
    onPress,
}: {
    testID: string;
    label: string;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            android_ripple={{ color: colors.border }}
            style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <View
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    borderWidth: 1.6,
                    borderColor: selected ? colors.primary : colors.trackOff,
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {selected ? (
                    <View
                        style={{
                            width: 9,
                            height: 9,
                            borderRadius: 5,
                            backgroundColor: colors.primary,
                        }}
                    />
                ) : null}
            </View>
            <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19 }}>{label}</Text>
        </Pressable>
    );
}
