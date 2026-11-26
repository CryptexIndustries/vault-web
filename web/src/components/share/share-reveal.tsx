import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { BrandBar } from "@/components/marketing/site";
import * as OTPAuth from "otpauth";
import QRCode from "react-qr-code";
import {
    AlertTriangle,
    Check,
    Copy,
    Download,
    ExternalLink,
    Eye,
    EyeOff,
    LoaderCircle,
    Lock,
} from "lucide-react";
import {
    SHARE_SLOW_REQUEST_MS,
    ShareClient,
    ShareServerError,
} from "@cryptex-industries/vault-core/vault-utils/share-client";
import {
    deriveShareKeys,
    deriveSharePeekToken,
    isValidShareId,
    openSharePayload,
    parseShareSecret,
    type ShareKeys,
    type SharePayload,
} from "@cryptex-industries/vault-core/vault-utils/share-link";
import { sshKeyFileName } from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { downloadTextFile } from "@/utils/ssh-key";

type RevealState =
    | { step: "loading" }
    | { step: "invalid" }
    | { step: "gone" }
    | { step: "unavailable" }
    | { step: "ready"; passphrase: boolean; expiresAt: number }
    | { step: "revealing"; passphrase: boolean; expiresAt: number }
    | { step: "revealed"; payload: SharePayload }
    | { step: "broken" };

type SlowReveal =
    | { step: "waiting" }
    | { step: "retry"; retry: () => void }
    | { step: "retrying" }
    | { step: "opened" };

const formatExpiry = (timestamp: number) =>
    new Date(timestamp).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });

export function ShareReveal({ id }: { id: string | undefined }) {
    const [state, setState] = useState<RevealState>({ step: "loading" });
    const [secret, setSecret] = useState<Uint8Array | null>(null);
    const [passphrase, setPassphrase] = useState("");
    const [error, setError] = useState("");
    // Set once revealing is slow. A retry runs alongside the first request.
    // Links with a passphrase get none: a wrong guess sent twice would use up
    // two tries.
    const [slow, setSlow] = useState<SlowReveal | null>(null);
    const router = useRouter();
    const left = useRef(false);
    const [leaveTo, setLeaveTo] = useState<
        { href: string } | { back: true } | null
    >(null);
    const revealing = state.step === "revealing";

    // The server deletes the secret as it sends it, so leaving now loses it.
    useEffect(() => {
        if (!revealing) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        const shareState: unknown = window.history.state;
        const shareUrl = window.location.href;
        router.beforePopState(() => {
            window.history.pushState(shareState, "", shareUrl);
            setLeaveTo({ back: true });
            return false;
        });
        return () => {
            window.removeEventListener("beforeunload", onBeforeUnload);
            router.beforePopState(() => true);
            setLeaveTo(null);
        };
    }, [revealing, router]);

    const leave = () => {
        if (!leaveTo) return;
        left.current = true;
        if ("href" in leaveTo) {
            void router.push(leaveTo.href);
        } else {
            router.beforePopState(() => true);
            window.history.back();
        }
    };

    useEffect(() => {
        if (id === undefined) return;
        const parsedSecret = parseShareSecret(window.location.hash);
        if (!isValidShareId(id) || !parsedSecret) {
            setState({ step: "invalid" });
            return;
        }
        setSecret(parsedSecret);
        let cancelled = false;
        void (async () => {
            try {
                const info = await new ShareClient(window.location.origin).peek(
                    id,
                    deriveSharePeekToken(parsedSecret),
                );
                if (!cancelled) setState({ step: "ready", ...info });
            } catch (err) {
                if (cancelled) return;
                setState({
                    step:
                        err instanceof ShareServerError && err.code === "gone"
                            ? "gone"
                            : "unavailable",
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [id]);

    const reveal = useCallback(async () => {
        if (!id || !secret || state.step !== "ready") return;
        if (state.passphrase && !passphrase) {
            setError("Enter the passphrase you were given.");
            return;
        }
        setError("");
        setState({ ...state, step: "revealing" });
        const usedPassphrase = state.passphrase ? passphrase : undefined;
        let keys: ShareKeys;
        try {
            keys = await deriveShareKeys(secret, usedPassphrase);
        } catch {
            setState({ ...state, step: "ready" });
            setError("Couldn't reach the server. Try again.");
            return;
        }
        const client = new ShareClient(window.location.origin);
        let pending = 0;
        let settled = false;
        let gone = false;
        const settle = () => {
            settled = true;
            window.clearTimeout(slowTimer);
            setSlow(null);
        };
        const send = async () => {
            pending += 1;
            let ciphertext: Uint8Array;
            try {
                ciphertext = await client.reveal(
                    id,
                    keys.peekToken,
                    keys.revealToken,
                );
            } catch (err) {
                pending -= 1;
                if (err instanceof ShareServerError && err.code === "gone") {
                    gone = true;
                }
                // A "gone" from a retry can mean an earlier request got the
                // secret, so wait for every request before giving up.
                if (settled || pending > 0) return;
                settle();
                if (gone) {
                    setState({ step: "gone" });
                    return;
                }
                if (
                    err instanceof ShareServerError &&
                    err.code === "wrong_passphrase"
                ) {
                    setState({ ...state, step: "ready" });
                    setError(
                        `Wrong passphrase. ${err.attemptsLeft ?? 0} ${
                            err.attemptsLeft === 1 ? "try" : "tries"
                        } left before the link is destroyed.`,
                    );
                    return;
                }
                setState({ ...state, step: "ready" });
                setError("Couldn't reach the server. Try again.");
                return;
            }
            if (settled) return;
            settle();
            // The recipient left, so the address bar belongs to the next page.
            if (left.current) return;
            // The server has deleted it now. Drop the key from the address bar
            // and history; a reload can't bring the secret back anyway.
            window.history.replaceState(null, "", window.location.pathname);
            try {
                const payload = await openSharePayload(
                    ciphertext,
                    secret,
                    usedPassphrase,
                );
                setState({ step: "revealed", payload });
            } catch {
                setState({ step: "broken" });
            } finally {
                setPassphrase("");
            }
        };
        const retry = async () => {
            // A click can land before React hides the button after settling.
            if (settled) return;
            setSlow({ step: "retrying" });
            await send();
            // After a "gone" only a request still on its way can bring the
            // secret, so another retry can't help.
            if (!settled) {
                setSlow(
                    gone
                        ? { step: "opened" }
                        : { step: "retry", retry: () => void retry() },
                );
            }
        };
        const slowTimer = window.setTimeout(
            () =>
                setSlow(
                    state.passphrase
                        ? { step: "waiting" }
                        : { step: "retry", retry: () => void retry() },
                ),
            SHARE_SLOW_REQUEST_MS,
        );
        await send();
    }, [id, passphrase, secret, state]);

    return (
        <div
            className="dark flex min-h-svh flex-col bg-background text-foreground"
            // Runs before next/link, which then ignores the prevented click.
            onClickCapture={(event) => {
                const link = (event.target as Element).closest("a");
                if (
                    !revealing ||
                    !link ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                ) {
                    return;
                }
                event.preventDefault();
                setLeaveTo({ href: link.href });
            }}
        >
            <BrandBar />
            <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
                <ShareRevealBody
                    state={state}
                    passphrase={passphrase}
                    onPassphraseChange={setPassphrase}
                    error={error}
                    onReveal={() => void reveal()}
                    slow={slow}
                />
            </main>
            <footer className="border-t border-border">
                <div className="mx-auto max-w-2xl px-4 py-4 text-xs text-muted-foreground">
                    Shared with{" "}
                    <Link className="underline underline-offset-2" href="/">
                        Cryptex Vault
                    </Link>
                    , an open-source password manager. The sender&apos;s device
                    encrypted this secret, and your browser decrypted it.
                </div>
            </footer>
            <AlertDialog
                open={leaveTo !== null}
                onOpenChange={(open) => {
                    if (!open) setLeaveTo(null);
                }}
            >
                <AlertDialogContent className="dark text-foreground">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Leave and lose this secret?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            It&apos;s opening now, and the server deletes it as
                            it sends it. If you leave, you can&apos;t open it
                            again.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Stay</AlertDialogCancel>
                        <Button variant="destructive" onClick={leave}>
                            Leave
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function Notice({
    title,
    children,
    tone = "muted",
}: {
    title: string;
    children: React.ReactNode;
    tone?: "muted" | "warning";
}) {
    return (
        <div className="space-y-2 py-8 text-center">
            {tone === "warning" ? (
                <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            ) : null}
            <h1 className="text-xl font-semibold">{title}</h1>
            <div className="text-sm text-muted-foreground">{children}</div>
        </div>
    );
}

function ShareRevealBody({
    state,
    passphrase,
    onPassphraseChange,
    error,
    onReveal,
    slow,
}: {
    state: RevealState;
    passphrase: string;
    onPassphraseChange: (value: string) => void;
    error: string;
    onReveal: () => void;
    slow: SlowReveal | null;
}) {
    switch (state.step) {
        case "loading":
            return (
                <div
                    className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
                    role="status"
                >
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Checking the link…
                </div>
            );
        case "invalid":
            return (
                <Notice title="This link is incomplete" tone="warning">
                    Part of the link is missing. Some apps cut long links; ask
                    the sender to paste it again.
                </Notice>
            );
        case "gone":
            return (
                <Notice title="This link no longer works">
                    It was already opened, it expired, or the sender revoked it.
                    Ask the sender for a new one.
                </Notice>
            );
        case "unavailable":
            return (
                <Notice title="Can't reach the server" tone="warning">
                    Check your connection and reload the page. The link
                    hasn&apos;t been used.
                </Notice>
            );
        case "broken":
            return (
                <Notice
                    title="This secret couldn't be decrypted"
                    tone="warning"
                >
                    The server has already deleted it. Ask the sender to share
                    it again.
                </Notice>
            );
        case "ready":
        case "revealing":
            return (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <h1 className="text-2xl font-semibold">
                            Someone shared a secret with you
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            You can view it once. After that it&apos;s deleted
                            from the server, so have somewhere ready to save it.
                            Unopened, it expires {formatExpiry(state.expiresAt)}
                            .
                        </p>
                    </div>
                    {state.passphrase ? (
                        <div className="space-y-2">
                            <Label
                                htmlFor="share-passphrase"
                                className="flex items-center gap-2"
                            >
                                <Lock className="h-3.5 w-3.5" />
                                Passphrase
                            </Label>
                            <PasswordInput
                                id="share-passphrase"
                                value={passphrase}
                                autoFocus
                                autoComplete="off"
                                secretLabel="passphrase"
                                disabled={state.step === "revealing"}
                                onChange={(event) =>
                                    onPassphraseChange(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onReveal();
                                }}
                            />
                            <p className="text-xs text-muted-foreground">
                                The sender should have sent this separately.
                            </p>
                        </div>
                    ) : null}
                    {error ? (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    ) : null}
                    <Button
                        size="lg"
                        className="w-full gap-2 sm:w-auto"
                        disabled={state.step === "revealing"}
                        onClick={onReveal}
                    >
                        {state.step === "revealing" ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                            <Eye className="h-4 w-4" />
                        )}
                        {state.step === "revealing"
                            ? "Opening…"
                            : "Reveal secret"}
                    </Button>
                    {slow ? (
                        <div className="space-y-3" role="status">
                            <p className="text-sm text-muted-foreground">
                                {slow.step === "waiting"
                                    ? "This is taking longer than usual. Keep this page open."
                                    : slow.step === "opened"
                                      ? "The server says the secret has already been opened, probably by your first attempt, which is still loading. Keep this page open to receive it."
                                      : "This is taking longer than usual. You can keep waiting, or try again."}
                            </p>
                            {slow.step === "retry" ? (
                                <Button variant="outline" onClick={slow.retry}>
                                    Try again
                                </Button>
                            ) : null}
                            {slow.step === "retrying" ? (
                                <Button
                                    variant="outline"
                                    className="gap-2"
                                    disabled
                                >
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                    Trying again…
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            );
        case "revealed":
            return <RevealedPayload payload={state.payload} />;
    }
}

function RevealedPayload({ payload }: { payload: SharePayload }) {
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold">
                    {payload.title || "Shared secret"}
                </h1>
                <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    This is the only time you can see this. The server has
                    already deleted it, so save what you need before you leave
                    the page.
                </p>
            </div>
            <dl className="space-y-4">
                {payload.fields.map((field, index) => (
                    <RevealedField
                        key={index}
                        field={field}
                        title={payload.title}
                    />
                ))}
            </dl>
            <div className="rounded-lg border border-border p-4 text-sm">
                <p className="font-medium">Keep it somewhere safe</p>
                <p className="mt-1 text-muted-foreground">
                    Cryptex Vault stores passwords encrypted on your own
                    devices. It&apos;s free and open source.
                </p>
                <Link
                    href="/"
                    className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                >
                    Try Cryptex Vault
                    <ExternalLink className="h-3.5 w-3.5" />
                </Link>
            </div>
        </div>
    );
}

function useCopy() {
    const [copied, setCopied] = useState(false);
    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };
    return { copied, copy };
}

function CopyButton({ value, label }: { value: string; label: string }) {
    const { copied, copy } = useCopy();
    return (
        <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={`Copy ${label}`}
            onClick={() => void copy(value)}
        >
            {copied ? (
                <Check className="h-4 w-4 text-green-500" />
            ) : (
                <Copy className="h-4 w-4" />
            )}
        </Button>
    );
}

const OPENSSH_PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----";

function RevealedField({
    field,
    title,
}: {
    field: SharePayload["fields"][number];
    title: string;
}) {
    const [shown, setShown] = useState(field.kind !== "secret");
    if (field.kind === "totp") return <TotpField field={field} />;
    const keyFile =
        field.kind === "secret" &&
        field.value.trimStart().startsWith(OPENSSH_PRIVATE_KEY)
            ? sshKeyFileName(title)
            : null;
    return (
        <div className="space-y-1.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {field.label}
            </dt>
            <dd className="flex items-start gap-2">
                <div
                    className={cn(
                        "min-w-0 flex-1 break-words rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm",
                        (field.kind === "multiline" ||
                            field.kind === "secret") &&
                            "whitespace-pre-wrap",
                    )}
                >
                    {shown ? field.value : "•".repeat(12)}
                </div>
                {field.kind === "secret" ? (
                    <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        aria-label={shown ? "Hide" : "Show"}
                        onClick={() => setShown((value) => !value)}
                    >
                        {shown ? (
                            <EyeOff className="h-4 w-4" />
                        ) : (
                            <Eye className="h-4 w-4" />
                        )}
                    </Button>
                ) : null}
                {keyFile ? (
                    <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        aria-label={`Save ${field.label} as a file`}
                        onClick={() =>
                            downloadTextFile(
                                keyFile,
                                field.value.endsWith("\n")
                                    ? field.value
                                    : `${field.value}\n`,
                            )
                        }
                    >
                        <Download className="h-4 w-4" />
                    </Button>
                ) : null}
                <CopyButton value={field.value} label={field.label} />
            </dd>
            {keyFile ? (
                <p className="text-xs text-muted-foreground">
                    Saves as{" "}
                    <span className="font-mono text-foreground">{keyFile}</span>
                    . Before using it with ssh, run{" "}
                    <span className="font-mono text-foreground">
                        chmod 600 {keyFile}
                    </span>
                    .
                </p>
            ) : null}
        </div>
    );
}

/**
 * The payload comes from the sender, so only well-formed, ordinary TOTP
 * settings get a live code and QR code. Anything else is shown as text.
 */
function parseSafeTotp(value: string): OTPAuth.TOTP | null {
    if (value.length > 2048) return null;
    try {
        const parsed = OTPAuth.URI.parse(value);
        if (
            !(parsed instanceof OTPAuth.TOTP) ||
            parsed.digits < 6 ||
            parsed.digits > 10 ||
            parsed.period < 1 ||
            parsed.period > 300 ||
            parsed.secret.bytes.byteLength > 128
        ) {
            return null;
        }
        parsed.generate();
        return parsed;
    } catch {
        return null;
    }
}

function generateCode(totp: OTPAuth.TOTP, timestamp: number): string | null {
    try {
        return totp.generate({ timestamp });
    } catch {
        return null;
    }
}

function TotpField({ field }: { field: SharePayload["fields"][number] }) {
    const [totp, setTotp] = useState<OTPAuth.TOTP | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        setTotp(parseSafeTotp(field.value));
    }, [field.value]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const code = totp ? generateCode(totp, now) : null;
    if (!totp || code === null) {
        return (
            <div className="space-y-1.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {field.label}
                </dt>
                <dd className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                        {field.value}
                    </div>
                    <CopyButton value={field.value} label={field.label} />
                </dd>
            </div>
        );
    }

    const remaining = totp.period - (Math.floor(now / 1000) % totp.period);
    return (
        <div className="space-y-1.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {field.label}
            </dt>
            <dd className="space-y-3">
                <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-lg tracking-widest">
                        {code}
                        <span className="ml-3 text-xs tracking-normal text-muted-foreground">
                            {remaining}s
                        </span>
                    </div>
                    <CopyButton value={code} label="code" />
                </div>
                <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center">
                    <div className="w-fit rounded bg-white p-2">
                        <QRCode value={field.value} size={128} />
                    </div>
                    <div className="min-w-0 space-y-2 text-sm text-muted-foreground">
                        <p>
                            To keep generating codes, scan this with your
                            authenticator app or enter the setup key.
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 break-all text-xs">
                                {totp.secret.base32}
                            </code>
                            <CopyButton
                                value={totp.secret.base32}
                                label="setup key"
                            />
                        </div>
                    </div>
                </div>
            </dd>
        </div>
    );
}
