"use client";

import { useCallback, useMemo, useRef } from "react";
import { ClipboardPaste } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
    RECOVERY_PHRASE_WORD_COUNT,
    joinRecoveryPhrase,
    normalizeRecoveryWord,
    splitRecoveryPhrase,
    splitRecoveryPhraseIntoSlots,
} from "./recovery-kit-utils";

type RecoveryPhraseInputProps = {
    id?: string;
    value: string;
    onChange: (phrase: string) => void;
    disabled?: boolean;
    wordCount?: number;
};

export function RecoveryPhraseInput({
    id = "recover-phrase",
    value,
    onChange,
    disabled = false,
    wordCount = RECOVERY_PHRASE_WORD_COUNT,
}: RecoveryPhraseInputProps) {
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

    const words = useMemo(
        () => splitRecoveryPhraseIntoSlots(value, wordCount),
        [value, wordCount],
    );

    const filledWordCount = useMemo(
        () => words.filter((word) => word.length > 0).length,
        [words],
    );

    const emitWords = useCallback(
        (nextWords: string[]) => {
            onChange(joinRecoveryPhrase(nextWords, wordCount));
        },
        [onChange, wordCount],
    );

    const focusWord = useCallback(
        (index: number) => {
            const clamped = Math.max(0, Math.min(index, wordCount - 1));
            inputRefs.current[clamped]?.focus();
        },
        [wordCount],
    );

    const applyWordsFromIndex = useCallback(
        (startIndex: number, incoming: string[]) => {
            const next = [...words];
            incoming.forEach((word, offset) => {
                const target = startIndex + offset;
                if (target >= wordCount) return;
                next[target] = normalizeRecoveryWord(word);
            });
            emitWords(next);

            const lastFilled = Math.min(
                startIndex + incoming.length - 1,
                wordCount - 1,
            );
            focusWord(lastFilled + 1 < wordCount ? lastFilled + 1 : lastFilled);
        },
        [emitWords, focusWord, wordCount, words],
    );

    const handleWordChange = (index: number, rawValue: string) => {
        const parts = rawValue.split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
            applyWordsFromIndex(index, parts);
            return;
        }

        const next = [...words];
        next[index] = normalizeRecoveryWord(parts[0] ?? rawValue);
        emitWords(next);
    };

    const handlePasteText = useCallback(
        (text: string, startIndex = 0) => {
            const parsed = splitRecoveryPhrase(text).map(normalizeRecoveryWord);
            if (parsed.length === 0) {
                toast.error("Clipboard does not contain a recovery phrase.");
                return;
            }

            applyWordsFromIndex(startIndex, parsed);

            if (parsed.length !== wordCount) {
                toast.message(
                    `Pasted ${parsed.length} of ${wordCount} words. Fill or paste the full phrase.`,
                );
            }
        },
        [applyWordsFromIndex, wordCount],
    );

    const handlePasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            handlePasteText(text, 0);
        } catch {
            toast.error("Could not read from clipboard.");
        }
    };

    const handleKeyDown = (
        index: number,
        event: React.KeyboardEvent<HTMLInputElement>,
    ) => {
        if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            if (index < wordCount - 1) {
                focusWord(index + 1);
            }
            return;
        }

        if (event.key === "Backspace" && words[index] === "" && index > 0) {
            event.preventDefault();
            focusWord(index - 1);
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={`${id}-1`}>Recovery phrase</Label>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-2"
                    disabled={disabled}
                    onClick={() => void handlePasteFromClipboard()}
                >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste phrase
                </Button>
            </div>

            <ol
                className={cn(
                    "grid gap-2 rounded-md border bg-muted/20 p-3",
                    "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
                )}
            >
                {words.map((word, index) => (
                    <li
                        key={index}
                        className="flex min-w-0 items-center gap-1.5"
                    >
                        <span
                            className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                            aria-hidden
                        >
                            {index + 1}.
                        </span>
                        <Input
                            ref={(node) => {
                                inputRefs.current[index] = node;
                            }}
                            id={index === 0 ? `${id}-1` : undefined}
                            value={word}
                            disabled={disabled}
                            onChange={(event) =>
                                handleWordChange(index, event.target.value)
                            }
                            onKeyDown={(event) => handleKeyDown(index, event)}
                            onPaste={(event) => {
                                event.preventDefault();
                                handlePasteText(
                                    event.clipboardData.getData("text"),
                                    index,
                                );
                            }}
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className="h-8 min-w-0 flex-1 px-2 font-mono text-xs"
                            aria-label={`Recovery phrase word ${index + 1}`}
                        />
                    </li>
                ))}
            </ol>

            <p className="text-xs text-muted-foreground">
                Enter each word from your Recovery Kit in order, or paste the
                full phrase. {filledWordCount}/{wordCount} words entered.
            </p>
        </div>
    );
}
