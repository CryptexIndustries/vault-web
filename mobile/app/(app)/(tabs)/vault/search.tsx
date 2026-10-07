import { memo, useMemo, useRef, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    View,
    type TextInput,
} from "react-native";
import { router } from "expo-router";
import { useAtomValue } from "jotai";
import { AlignLeft, Copy, Search, Tag, Type, X } from "lucide-react-native";

import { ItemType } from "@cryptex-industries/vault-core/proto";
import { vaultCredentialsAtom } from "@/utils/atoms";
import { completeSearchField, filterCredentials, searchFieldSuggestions } from "@/utils/credential-search";
import { copySecretToClipboard } from "@/utils/clipboard";
import {
    UnlockedTaskHeader,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Input } from "@/components/ui/input";
import { SafeAreaView } from "react-native-safe-area-context";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import { colors } from "@/theme";

const searchInputStyle = { fontFamily: "sans-serif" };

export default function VaultSearchScreen() {
    const credentials = useAtomValue(vaultCredentialsAtom);
    const [query, setQuery] = useState("");
    const inputRef = useRef<TextInput>(null);
    const [focused, setFocused] = useState(false);
    const [hasUserInput, setHasUserInput] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const suggestions = focused && hasUserInput && !dismissed
        ? searchFieldSuggestions(query)
        : [];
    const changeQuery = (value: string) => {
        setQuery(value);
        setHasUserInput(true);
        setDismissed(false);
    };
    const applyField = (field: string) => {
        const next = completeSearchField(query, field);
        setQuery(next);
        setDismissed(true);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setNativeProps({
                selection: { start: next.length, end: next.length },
            });
        });
    };
    const active = useMemo(
        () => credentials.filter((entry) => !entry.Deleted),
        [credentials],
    );
    const results = useMemo(
        () => filterCredentials(active, query),
        [active, query],
    );

    const suggestionsPopup = suggestions.length > 0 ? (
        <View
            accessibilityLabel="Search fields"
            style={{
                position: "absolute",
                top: 84,
                left: 20,
                right: 20,
                zIndex: 20,
                elevation: 8,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                backgroundColor: colors.secondary,
                shadowColor: "#000000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.24,
                shadowRadius: 8,
            }}
        >
            <View style={{ borderRadius: 12, overflow: "hidden", paddingVertical: 4 }}>
                {suggestions.map((field) => {
                    const FieldIcon = field === "name" ? Type : field === "tag" ? Tag : AlignLeft;
                    const label = field === "name" ? "Name" : field === "tag" ? "Tag" : "Note";
                    return (
                        <Pressable
                            key={field}
                            accessibilityRole="button"
                            accessibilityLabel={`Search by ${field}`}
                            accessibilityHint={`Insert ${field}: into the search`}
                            onPress={() => applyField(field)}
                            android_ripple={{ color: colors.border }}
                            style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: "center" }}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                                <FieldIcon size={20} color={colors.muted} strokeWidth={1.7} />
                                <UnlockedText style={{ flex: 1, fontSize: 14 }}>{label}</UnlockedText>
                                <UnlockedText style={{ fontSize: 12, fontFamily: "monospace", color: colors.muted }}>{field}:</UnlockedText>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    ) : null;

    const header = (
        <View style={{ position: "relative" }}>
            <View
                style={{
                    height: 54,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 15,
                    marginBottom: 18,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 4,
                    backgroundColor: colors.secondary,
                }}
            >
                <Search size={21} color={colors.muted} strokeWidth={1.7} />
                <Input
                    ref={inputRef}
                    autoFocus
                    value={query}
                    onChangeText={changeQuery}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                        setFocused(false);
                        setHasUserInput(false);
                    }}
                    returnKeyType="search"
                    submitBehavior="submit"
                    onSubmitEditing={() => {
                        if (suggestions[0]) applyField(suggestions[0]);
                        else inputRef.current?.blur();
                    }}
                    placeholder="Search… try name: tag: or note:"
                    accessibilityLabel="Search your vault"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="min-h-12 flex-1 border-0 bg-transparent px-0"
                    style={searchInputStyle}
                />
                {query ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        onPress={() => {
                            changeQuery("");
                            inputRef.current?.focus();
                        }}
                        style={{
                            width: 48,
                            height: 48,
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: -14,
                        }}
                    >
                        <X size={19} color={colors.muted} />
                    </Pressable>
                ) : null}
            </View>

            <UnlockedText
                style={{ color: colors.muted, fontSize: 12, marginVertical: 10 }}
            >
                {results.length} result{results.length === 1 ? "" : "s"} across your vault
            </UnlockedText>
        </View>
    );

    return (
        <SafeAreaView
            edges={["top", "left", "right", "bottom"]}
            style={{ flex: 1, backgroundColor: colors.background }}
        >
            <UnlockedTaskHeader title="Search" />
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
                <View style={{ paddingHorizontal: 20, paddingTop: 24, zIndex: 10 }}>
                    {header}
                </View>
                <FlatList
                    data={results}
                    keyExtractor={(item) => item.ID}
                    renderItem={renderSearchResult}
                    onTouchStart={() => setDismissed(true)}
                    ListEmptyComponent={
                        query.trim() ? (
                            <View
                                style={{ alignItems: "center", paddingTop: 54 }}
                            >
                                <View
                                    style={{
                                        width: 76,
                                        height: 76,
                                        borderWidth: 1,
                                        borderColor: colors.border,
                                        borderRadius: 14,
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <Search size={31} color={colors.primary} />
                                </View>
                                <UnlockedText
                                    style={{
                                        fontSize: 28,
                                        fontWeight: "500",
                                        letterSpacing: -0.8,
                                        marginTop: 25,
                                    }}
                                >
                                    No matching items.
                                </UnlockedText>
                                <UnlockedText
                                    style={{
                                        color: colors.muted,
                                        fontSize: 14,
                                        lineHeight: 22,
                                        textAlign: "center",
                                        marginTop: 12,
                                    }}
                                >
                                    Try a different name, username, tag, or note.
                                </UnlockedText>
                            </View>
                        ) : null
                    }
                    windowSize={7}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        flexGrow: 1,
                        paddingHorizontal: 20,
                        paddingTop: 0,
                        paddingBottom: 30,
                    }}
                />
                {suggestionsPopup}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const SearchResult = memo(function SearchResult({
    item,
}: {
    item: VaultCredential;
}) {
    const secondary =
        item.Type === ItemType.Passkey && item.Passkey
            ? `Passkey: ${item.Passkey.UserDisplayName || item.Passkey.UserName}`
            : item.Username || "No username";
    return (
        <View
            key={item.ID}
            style={{
                minHeight: 72,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.Name || "Untitled"}, ${secondary}`}
                onPress={() =>
                    router.push(`/(app)/(tabs)/vault/${item.ID}`)
                }
                style={{
                    minHeight: 72,
                    minWidth: 0,
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                }}
            >
                <View
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: colors.secondary,
                    }}
                >
                    <UnlockedText
                        style={{
                            fontSize: 13,
                            fontWeight: "700",
                        }}
                    >
                        {(item.Name || "?").slice(0, 2).toUpperCase()}
                    </UnlockedText>
                </View>
                <View style={{ minWidth: 0, flex: 1 }}>
                    <UnlockedText
                        numberOfLines={1}
                        style={{
                            fontSize: 15,
                            fontWeight: "600",
                        }}
                    >
                        {item.Name || "Untitled"}
                    </UnlockedText>
                    <UnlockedText
                        numberOfLines={1}
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            marginTop: 5,
                        }}
                    >
                        {secondary}
                    </UnlockedText>
                </View>
            </Pressable>
            {item.Password ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${item.Name || "item"} password`}
                    onPress={() => void copySecretToClipboard(item.Password)}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Copy size={20} color={colors.muted} strokeWidth={1.7} />
                </Pressable>
            ) : null}
        </View>
    );
});

function renderSearchResult({ item }: { item: VaultCredential }) {
    return <SearchResult item={item} />;
}
