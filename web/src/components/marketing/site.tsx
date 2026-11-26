import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import {
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";
import {
    ArrowRight,
    Check,
    Menu,
    X,
    Monitor,
    Laptop,
    KeyRound,
    LockKeyhole,
    LockKeyholeOpen,
    Play,
    Pause,
} from "lucide-react";
import HTMLHeader from "@/components/html-header";
import s from "@/styles/Marketing.module.css";
import {
    currentPriceList,
    currentPriceListUrl,
    yearlySaving,
} from "@/lib/price-lists";

export const REPO = "https://github.com/CryptexIndustries/vault-web";
export const CHROME_WEB_STORE =
    "https://chromewebstore.google.com/detail/mmkjefiodfpafhkckekfdeccnkhphfhp";
export const FIREFOX_ADD_ONS =
    "https://addons.mozilla.org/en-US/firefox/addon/cryptex-vault/";
export const GOOGLE_PLAY =
    "https://play.google.com/store/apps/details?id=com.cryptexindustries.vault";
export const APP_STORE =
    "https://apps.apple.com/app/cryptex-vault/id6836340912";
export { s };
export function Action({
    href = "/app",
    children = "Open Cryptex Vault",
    secondary = false,
}: {
    href?: string;
    children?: ReactNode;
    secondary?: boolean;
}) {
    return (
        <Link
            className={`${secondary ? s.secondary : s.button} inline-flex min-h-[50px] items-center justify-center px-[23px] py-[16px] text-[13px] font-medium leading-[1.4]`}
            href={href}
            prefetch={!href.startsWith("/app")}
        >
            {children}
        </Link>
    );
}

/** The Cryptex Vault wordmark, linking home. */
export function Brand() {
    return (
        <Link
            href="/"
            className={`${s.brand} flex items-center gap-[12px]`}
            aria-label="Cryptex Vault home"
        >
            <Image
                src="/images/cryptex-vault-logo.svg"
                alt=""
                width="30"
                height="30"
            />
            <span className="flex gap-[9px]">
                CRYPTEX
                <span className="text-[var(--coral)]">VAULT</span>
            </span>
        </Link>
    );
}

/** The site header with only the wordmark, for focused pages. */
export function BrandBar() {
    return (
        <div className={`dark ${s.site} ${s.headerShell}`}>
            <header
                className={`${s.header} relative z-20 flex h-[96px] items-center`}
            >
                <Brand />
            </header>
        </div>
    );
}

function SiteHeader() {
    const [open, setOpen] = useState(false);
    const { pathname } = useRouter();
    const toggleRef = useRef<HTMLButtonElement>(null);
    const navigationRef = useRef<HTMLElement>(null);
    const closeMenu = () => {
        setOpen(false);
        toggleRef.current?.focus();
    };
    useEffect(() => {
        if (!open) return;
        navigationRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                toggleRef.current?.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        const desktop = window.matchMedia("(min-width: 901px)");
        const onResize = () => {
            if (desktop.matches) setOpen(false);
        };
        desktop.addEventListener("change", onResize);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            desktop.removeEventListener("change", onResize);
        };
    }, [open]);
    return (
        <div className={`dark ${s.site} ${s.headerShell}`}>
            <header
                className={`${s.header} relative z-20 flex h-[96px] items-center justify-between`}
            >
                <Brand />
                <button
                    ref={toggleRef}
                    className={`${s.menuButton} hidden`}
                    aria-label={open ? "Close navigation" : "Open navigation"}
                    aria-expanded={open}
                    aria-controls="site-navigation"
                    onClick={() => (open ? closeMenu() : setOpen(true))}
                >
                    {open ? <X /> : <Menu />}
                </button>
                <nav
                    ref={navigationRef}
                    id="site-navigation"
                    aria-label="Main navigation"
                    className={`${s.nav} flex items-center gap-[32px] text-[13px] ${open ? s.navOpen : ""}`}
                >
                    {[
                        ["/security", "Security"],
                        ["/pricing", "Pricing"],
                        ["/docs", "Docs"],
                        ["/roadmap", "Roadmap"],
                        ["/download", "Download"],
                    ].map(([href, label]) => (
                        <Link
                            key={href}
                            href={href!}
                            aria-current={
                                pathname === href ? "page" : undefined
                            }
                            onClick={() => {
                                if (open) closeMenu();
                            }}
                        >
                            {label}
                        </Link>
                    ))}
                    <a href="https://cryptexindustries.com/blog">Blog</a>
                    {pathname !== "/" && (
                        <Link
                            href="/app"
                            prefetch={false}
                            className={s.navCta}
                            onClick={() => {
                                if (open) closeMenu();
                            }}
                        >
                            Open Vault
                        </Link>
                    )}
                </nav>
            </header>
        </div>
    );
}
// Marketing pages are prerendered when the image is built, before the
// deployment's NEXT_PUBLIC_APP_URL is known, so the public origin is fixed.
const SITE_ORIGIN = "https://www.cryptex-vault.com";

export function Site({
    title,
    description,
    linkPreview = true,
    children,
}: {
    title: string;
    description: string;
    linkPreview?: boolean;
    children: ReactNode;
}) {
    const { pathname } = useRouter();
    return (
        <div className={`dark ${s.site}`}>
            <HTMLHeader
                title={
                    title === "Cryptex Vault"
                        ? title
                        : `${title} - Cryptex Vault`
                }
                description={description}
                url={linkPreview ? SITE_ORIGIN + pathname : undefined}
            />
            <a className={s.skip} href="#main">
                Skip to content
            </a>
            <SiteHeader />
            <main id="main">{children}</main>
            <footer className={s.footer}>
                <div className={`${s.footerTop} grid gap-[40px]`}>
                    <div className="flex flex-col items-start gap-[9px]">
                        <Link
                            href="/"
                            className={`${s.brand} flex items-center gap-[12px]`}
                            aria-label="Cryptex Vault home"
                        >
                            <span className="flex gap-[9px]">
                                CRYPTEX
                                <span className="text-[var(--coral)]">
                                    VAULT
                                </span>
                            </span>
                        </Link>
                        <a href="https://cryptexindustries.com">
                            Cryptex Industries d.o.o.
                        </a>
                        <a href="https://cryptexindustries.com/blog">
                            Read our blog
                        </a>
                    </div>
                    <div className="flex flex-col items-start gap-[9px]">
                        <span>PRODUCT</span>
                        <Link href="/app" prefetch={false}>
                            Open Vault
                        </Link>
                        <Link href="/pricing">Pricing</Link>
                        <Link href="/roadmap">Roadmap</Link>
                        <Link href="/download" className="mt-3">
                            Browser Extension
                        </Link>
                        <Link href="/download/android">Android app</Link>
                        <a href={APP_STORE}>iOS app</a>
                        <Link href="/docs/ssh-agent#install">SSH agent</Link>
                    </div>
                    <div className="flex flex-col items-start gap-[9px]">
                        <span>RESOURCES</span>
                        <Link href="/docs">Documentation</Link>
                        <Link href="/changelog">Changelog</Link>
                        <Link href="/docs/self-hosting">Self-hosting</Link>
                        <a href={REPO} className="mt-3">
                            Source code on GitHub
                        </a>
                        <a href="mailto:support@cryptex-vault.com">Support</a>
                    </div>
                    <div className="flex flex-col items-start gap-[9px]">
                        <span>TRUST</span>
                        <Link href="/security">Security</Link>
                        <Link href="/security/responsible-disclosure">
                            Responsible disclosure
                        </Link>
                        <a
                            href="mailto:security@cryptex-vault.com"
                            className="mt-3"
                        >
                            Security contact
                        </a>
                    </div>
                </div>
                <div
                    className={`${s.footerBottom} flex justify-between gap-[20px]`}
                >
                    <span>
                        © {new Date().getFullYear()} Cryptex Industries d.o.o. -
                        Croatia - OIB 55912170784
                    </span>
                    <div className="flex gap-[25px]">
                        <Link href="/privacy">Privacy</Link>
                        <Link href="/terms">Terms</Link>
                        <a href={currentPriceListUrl}>Price list CSV</a>
                    </div>
                    <span>OPEN SOURCE. LOCAL FIRST.</span>
                </div>
            </footer>
        </div>
    );
}
export function Label({ children }: { children: ReactNode }) {
    return (
        <p className={s.eyebrow}>
            <span />
            {children}
        </p>
    );
}
// Animate only after an element enters view. The default DOM stays visible,
// including when JavaScript, IntersectionObserver, or animation support is absent.
function useSectionEntrance() {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        const section = ref.current;
        const preference = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        );
        if (
            !section ||
            preference.matches ||
            !("IntersectionObserver" in window)
        )
            return;
        const animations = new Set<Animation>();
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    observer.unobserve(entry.target);
                    if (preference.matches || !("animate" in entry.target))
                        continue;
                    const animation = entry.target.animate(
                        [
                            { opacity: 0.25, transform: "translateY(16px)" },
                            { opacity: 1, transform: "translateY(0)" },
                        ],
                        {
                            duration: 600,
                            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                        },
                    );
                    animations.add(animation);
                    animation.onfinish = () => animations.delete(animation);
                }
            },
            { rootMargin: "0px 0px -32px 0px", threshold: 0 },
        );
        Array.from(section.children).forEach((child) =>
            observer.observe(child),
        );
        const stop = () => {
            observer.disconnect();
            animations.forEach((animation) => animation.cancel());
            animations.clear();
        };
        preference.addEventListener("change", stop);
        return () => {
            stop();
            preference.removeEventListener("change", stop);
        };
    }, []);
    return ref;
}

export function Section({
    id,
    number,
    label,
    children,
    className = "",
}: {
    id?: string;
    number?: string;
    label?: string;
    children: ReactNode;
    className?: string;
}) {
    const entranceRef = useSectionEntrance();
    return (
        <section
            ref={entranceRef}
            id={id}
            className={`${s.section} ${className}`}
        >
            {label && (
                <div className={s.sectionLabel}>
                    <span>
                        {number} / {label}
                    </span>
                </div>
            )}
            {children}
        </section>
    );
}
export function FinalCTA() {
    const entranceRef = useSectionEntrance();
    return (
        <section ref={entranceRef} className={s.finalCta}>
            <h2>
                Make yourself
                <br />
                at home.
            </h2>
            <div>
                <p>
                    Create a vault. Import your passwords.
                    <br />
                    No account required for local use.
                </p>
                <div className={s.finalActions}>
                    <Action />
                    <Action href="/download" secondary>
                        Install browser extension
                    </Action>
                    <Action href="/download/android" secondary>
                        Get the Android app
                    </Action>
                    <Action href={APP_STORE} secondary>
                        Get the iOS app
                    </Action>
                </div>
            </div>
        </section>
    );
}
export function Network({
    hero = false,
    minimal = false,
    detailed = false,
}: {
    hero?: boolean;
    minimal?: boolean;
    detailed?: boolean;
}) {
    const [step, setStep] = useState(0);
    const relay = detailed ? step === 3 : step === 1;
    const phase = step;
    const [paused, setPaused] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);
    const networkRef = useRef<HTMLDivElement>(null);
    const drawingRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const preference = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        );
        const update = () => setReducedMotion(preference.matches);
        update();
        preference.addEventListener("change", update);
        return () => preference.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        const element = networkRef.current;
        if (!element || paused || reducedMotion) return;
        let visible = false;
        let timer: number | undefined;
        const update = () => {
            window.clearInterval(timer);
            if (visible && !document.hidden) {
                timer = window.setInterval(
                    () =>
                        setStep(
                            (current) => (current + 1) % (detailed ? 4 : 2),
                        ),
                    detailed ? 2600 : 7000,
                );
            }
        };
        const observer = new IntersectionObserver(
            ([entry]) => {
                visible = entry?.isIntersecting ?? false;
                update();
            },
            { threshold: 0.25 },
        );
        observer.observe(element);
        document.addEventListener("visibilitychange", update);
        return () => {
            window.clearInterval(timer);
            observer.disconnect();
            document.removeEventListener("visibilitychange", update);
        };
    }, [paused, reducedMotion, detailed]);
    useEffect(() => {
        const drawing = drawingRef.current;
        if (!hero || !drawing || reducedMotion || paused) return;
        const tilt = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;
            const box = drawing.getBoundingClientRect();
            // Clamped so the angle stays small while the hero is scrolled away.
            const clamp = (offset: number) => Math.max(-1, Math.min(1, offset));
            const x = clamp(
                (event.clientX - box.left - box.width / 2) / innerWidth,
            );
            const y = clamp(
                (event.clientY - box.top - box.height / 2) / innerHeight,
            );
            drawing.style.setProperty("--tilt-x", `${x * 18}deg`);
            drawing.style.setProperty("--tilt-y", `${-y * 18}deg`);
        };
        window.addEventListener("pointermove", tilt);
        return () => window.removeEventListener("pointermove", tilt);
    }, [hero, reducedMotion, paused]);
    // A packet reaches the other device 1980ms into its 4400ms round trip and the laptop at 4180ms.
    const vault = (side: "left" | "right") => {
        const arrival = side === "left" ? 4180 : 1980;
        return (
            <div
                key={`vault-${relay}`}
                className={`pointer-events-none absolute top-[12px] h-[34px] w-[52px] [transform-style:preserve-3d] max-[720px]:!left-[calc(50%-26px)] max-[720px]:top-[-48px] max-[720px]:[--dir:0] ${side === "left" ? "right-[calc(50%+38px)] [--dir:-1]" : "left-[calc(50%+38px)] [--dir:1]"}`}
            >
                {[0, 1, 2, 3].map((depth) => (
                    <div
                        key={depth}
                        className={`${s.vaultCard} absolute inset-0 flex items-center gap-[5px] rounded-[5px] border border-[rgba(252,248,236,0.4)] bg-[var(--navy)] px-[6px] text-[var(--coral)]`}
                        style={
                            {
                                "--depth": depth,
                                animationDelay: `${arrival - depth * 4400}ms`,
                            } as CSSProperties
                        }
                    >
                        <KeyRound size={12} />
                        <i className="h-[3px] flex-1 rounded-full bg-[var(--soft)] blur-[1.5px]" />
                    </div>
                ))}
            </div>
        );
    };
    const lock = (side: "left" | "right") => (
        <div
            key={`lock-${relay}`}
            className={`${side === "right" ? s.vaultLockRight : ""} relative size-[16px] text-[var(--coral)]`}
        >
            <LockKeyhole size={16} className={s.lockShut} />
            <LockKeyholeOpen
                size={16}
                className={`${s.lockOpen} absolute inset-0 opacity-0`}
            />
        </div>
    );
    const packets = (route: "direct" | "relay") =>
        (hero ? [0, 1, 2, 3] : [0]).map((lag) => (
            <circle
                key={`${route}-transfer-${lag}`}
                className={`${s.packet} ${route === "relay" ? s.relayPacket : s.directPacket} ${lag ? "!fill-[var(--coral)]" : ""}`}
                r={2.5 - lag * 0.4}
                style={{
                    animationDelay: `${lag * 80}ms`,
                    fillOpacity: 1 - lag * 0.22,
                }}
            />
        ));
    const relayRoute = (
        <g className={s.relayRoute}>
            <path d="M 0 52 L 50 52 L 85 18 L 115 18 L 150 52 L 200 52" />
            {relay && packets("relay")}
            <rect x="89" y="7" width="22" height="22" rx="3" />
            <path d="M 95 14 H 105 M 95 18 H 105 M 95 22 H 105" />
        </g>
    );
    return (
        <div
            ref={networkRef}
            data-paused={paused || reducedMotion}
            data-phase={detailed ? phase : 2}
            className={`${s.network} ${hero ? s.heroNetwork : ""} ${detailed ? s.detailedNetwork : ""}`}
        >
            <div className={s.networkTop}>
                <div
                    className={`${s.networkControls} flex flex-wrap items-center justify-end gap-x-[22px] gap-y-[12px]`}
                >
                    {reducedMotion ? (
                        <button
                            aria-label={
                                detailed
                                    ? "Next connection step"
                                    : relay
                                      ? "View direct connection"
                                      : "View relay fallback"
                            }
                            onClick={() =>
                                setStep(
                                    (current) =>
                                        (current + 1) % (detailed ? 4 : 2),
                                )
                            }
                        >
                            {detailed
                                ? "Next step"
                                : relay
                                  ? "View direct connection"
                                  : "View relay fallback"}
                            <ArrowRight size={14} />
                        </button>
                    ) : (
                        <button
                            className={s.demoToggle}
                            aria-label={
                                paused
                                    ? "Play connection demo"
                                    : "Pause connection demo"
                            }
                            title={
                                paused
                                    ? "Play connection demo"
                                    : "Pause connection demo"
                            }
                            onClick={() => setPaused(!paused)}
                        >
                            {paused ? (
                                <Play size={15} aria-hidden="true" />
                            ) : (
                                <Pause size={15} aria-hidden="true" />
                            )}
                        </button>
                    )}
                </div>
            </div>
            <div
                ref={drawingRef}
                className={`${s.networkDrawing} ${hero ? "transition-transform duration-700 ease-out [transform-style:preserve-3d] [transform:perspective(1000px)_rotateX(var(--tilt-y,0deg))_rotateY(var(--tilt-x,0deg))]" : ""}`}
            >
                {detailed && (
                    <>
                        <svg
                            className={s.signalingExchange}
                            viewBox="0 0 540 100"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                        >
                            <path d="M75 95 C75 35 190 5 270 5" />
                            <path d="M465 95 C465 35 350 5 270 5" />
                            <circle className={s.signalingLeftPulse} r="3" />
                            <circle className={s.signalingRightPulse} r="3" />
                        </svg>
                        <div
                            className={s.discoveryNode}
                            data-active={phase === 0}
                        >
                            <strong>Signaling server</strong>
                            <small>Introduces the peers</small>
                        </div>
                    </>
                )}
                {!hero && (
                    <>
                        <div className={s.orbit} />
                        <div className={s.orbitTwo} />
                    </>
                )}
                <div
                    className={`${s.device} ${hero ? "[transform-style:preserve-3d] [transform:translateZ(40px)]" : ""}`}
                >
                    <Laptop size={hero ? 58 : 38} strokeWidth={1} />
                    {hero ? lock("left") : <LockKeyhole size={16} />}
                    <span>YOUR LAPTOP</span>
                    <small>Encrypted local vault</small>
                    {hero && vault("left")}
                </div>
                <div
                    className={`${s.connection} ${relay ? s.relayActive : ""} ${hero ? "[transform-style:preserve-3d] [transform:translateZ(20px)]" : ""}`}
                >
                    <span className={s.connectionLabel}>
                        {detailed && phase === 0
                            ? "SIGNALING"
                            : detailed && phase === 1
                              ? "VERIFYING PEER"
                              : relay
                                ? "ENCRYPTED TURN RELAY"
                                : "DIRECT P2P"}
                    </span>
                    <div className="relative w-full [transform-style:preserve-3d]">
                        <svg
                            className={s.connectionRoute}
                            viewBox="0 0 200 72"
                            aria-hidden="true"
                        >
                            <g className={s.directRoute}>
                                <path d="M 0 52 L 200 52" />
                                {!relay &&
                                    (!detailed || phase === 2) &&
                                    packets("direct")}
                            </g>
                            {!hero && relayRoute}
                            {detailed && phase === 1 && (
                                <g className={s.authenticationExchange}>
                                    <circle
                                        className={s.authenticationRequest}
                                        r="3"
                                    />
                                    <circle
                                        className={s.authenticationResponse}
                                        r="3"
                                    />
                                </g>
                            )}
                            <circle
                                className={s.routeEndpoint}
                                cx="3"
                                cy="52"
                                r="2.5"
                            />
                            <circle
                                className={s.routeEndpoint}
                                cx="197"
                                cy="52"
                                r="2.5"
                            />
                        </svg>
                        {hero && (
                            <svg
                                className={`${s.connectionRoute} ${s.liftedRelay} absolute inset-0`}
                                viewBox="0 0 200 72"
                                aria-hidden="true"
                            >
                                {relayRoute}
                            </svg>
                        )}
                    </div>
                    <LockKeyhole size={15} />
                    <small>
                        {detailed && phase === 0
                            ? "Connection details only"
                            : "End-to-end encrypted"}
                    </small>
                </div>
                <div
                    className={`${s.device} ${hero ? "[transform-style:preserve-3d] [transform:translateZ(40px)]" : ""}`}
                >
                    <Monitor size={hero ? 58 : 38} strokeWidth={1} />
                    {hero ? lock("right") : <LockKeyhole size={16} />}
                    <span>YOUR OTHER DEVICE</span>
                    <small>Encrypted local vault</small>
                    {hero && vault("right")}
                </div>
            </div>
            <div className={s.networkBottom}>
                {detailed ? (
                    <div className="w-full">
                        <div
                            className={s.syncSequence}
                            aria-label="Illustrated synchronization steps"
                        >
                            {["Find peer", "Verify device"].map(
                                (label, index) => (
                                    <span
                                        key={label}
                                        data-active={phase === index}
                                    >
                                        <i />
                                        {label}
                                    </span>
                                ),
                            )}
                            <div
                                className={s.syncAlternatives}
                                aria-label="Alternative transfer routes"
                            >
                                <span data-active={phase === 2}>
                                    <i />
                                    Direct P2P
                                </span>
                                <b>OR</b>
                                <span data-active={phase === 3}>
                                    <i />
                                    TURN relay
                                </span>
                            </div>
                        </div>
                        <p className={s.syncCaption}>
                            {phase === 0
                                ? "Signaling helps your devices find each other."
                                : phase === 1
                                  ? "Linked devices authenticate an encrypted session."
                                  : relay
                                    ? "If direct P2P is unavailable, a TURN relay carries the encrypted changes instead."
                                    : "Encrypted changes travel directly between your devices when a direct route is available."}
                        </p>
                    </div>
                ) : (
                    !minimal && <span>YOUR DEVICES HOLD THE VAULT.</span>
                )}
            </div>
        </div>
    );
}
const coreFeatures: { title: string; description?: string }[] = [
    { title: "Local encrypted vault" },
    { title: "Web app, Android & iOS apps, Browser Extension" },
    { title: "Browser autofill" },
    { title: "Passkey support" },
    {
        title: "Basic security reports",
        description: "Find weak and reused passwords in your vault.",
    },
    { title: "Imports & exports" },
    {
        title: "Manual encrypted backups",
        description: "Download an encrypted vault copy to store separately.",
    },
    {
        title: "Backups to your own storage",
        description:
            "Upload encrypted backups automatically to S3-compatible buckets you control.",
    },
    {
        title: "Peer-to-peer synchronization",
        description:
            "Use your own signaling and relay infrastructure to sync linked vaults while both devices are online.",
    },
    { title: "Self-hosted sync infrastructure" },
    {
        title: "One-time share links on your own server",
        description:
            "Run the open-source share server and send links from your own domain.",
    },
    {
        title: "SSH keys and the SSH agent on your own relay",
        description:
            "Keep SSH keys in your vault and approve logins from your phone or the web app, through an agent relay you run.",
    },
];
export function Plans({ detailed = false }: { detailed?: boolean }) {
    const [annual, setAnnual] = useState(false);
    const price = annual ? currentPriceList.yearly : currentPriceList.monthly;
    const period = annual ? "year" : "month";
    return (
        <div>
            <div
                className={`${s.billing} mb-[20px] flex justify-end`}
                aria-label="Billing period"
            >
                <button aria-pressed={!annual} onClick={() => setAnnual(false)}>
                    Monthly
                </button>
                <button aria-pressed={annual} onClick={() => setAnnual(true)}>
                    Yearly <span>Save €{yearlySaving(currentPriceList)}</span>
                </button>
            </div>
            <div className={`${s.plans} grid grid-cols-[1fr_1fr] gap-[24px]`}>
                <article className={`${s.plan} flex flex-col items-start`}>
                    <Label>THE PASSWORD MANAGER</Label>
                    <h3>Cryptex Vault</h3>
                    <div
                        className={`${s.price} flex items-baseline gap-[10px]`}
                    >
                        €0 <span>/ forever</span>
                    </div>
                    <p>A complete password manager, on your own terms.</p>
                    <Action secondary />{" "}
                    {detailed && (
                        <>
                            <ul>
                                {coreFeatures.map((f) => (
                                    <li
                                        key={f.title}
                                        className={s.featureBenefit}
                                    >
                                        <Check size={16} />
                                        <span>
                                            {f.title}
                                            {f.description && (
                                                <small>{f.description}</small>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <small>
                                AGPL-3.0 - No Online Services account required
                                for local use.
                            </small>
                        </>
                    )}
                </article>
                <article
                    className={`${s.plan} ${s.paidPlan} flex flex-col items-start`}
                >
                    <Label>OPTIONAL MANAGED SERVICES</Label>
                    <h3>Online Services</h3>
                    <div
                        className={`${s.price} flex items-baseline gap-[10px]`}
                    >
                        €{Number(price.price)}
                        <span>/ {period}</span>
                    </div>
                    <small className={s.taxNote}>VAT included</small>
                    <small className={s.referencePrice}>
                        Price as of {currentPriceList.referenceDate}: €
                        {Number(price.referencePrice)} / {period}
                    </small>
                    <small className={s.referencePrice}>
                        14-day free trial on your first subscription
                    </small>
                    <p>
                        Your vault stays yours. We run the supporting
                        infrastructure.
                    </p>
                    <Action href={`/app?plan=${annual ? "yearly" : "monthly"}`}>
                        Continue with {annual ? "yearly" : "monthly"} plan
                    </Action>
                    <small className={s.purchaseNote}>
                        The trial needs a card, which is charged when the trial
                        ends unless you cancel first. New to Online Services?
                        Start with monthly billing before committing to a year.
                    </small>
                    {detailed && (
                        <>
                            <ul>
                                <li className={s.featureBenefit}>
                                    <Check size={16} />
                                    <span>
                                        Managed P2P infrastructure
                                        <small>
                                            Connect linked devices through
                                            hosted signaling and relay services,
                                            without maintaining servers.
                                        </small>
                                    </span>
                                </li>
                                <li className={s.featureBenefit}>
                                    <Check size={16} />
                                    <span>
                                        Managed encrypted backups
                                        <small>
                                            Keep encrypted restore points online
                                            and retrieve available backups with
                                            your Recovery Kit if a device is
                                            lost.
                                        </small>
                                    </span>
                                </li>
                                <li className={s.featureBenefit}>
                                    <Check size={16} />
                                    <span>
                                        One-time share links
                                        <small>
                                            Send a login or secret to anyone,
                                            even people without Cryptex Vault.
                                            It opens once, then it&apos;s
                                            deleted.
                                        </small>
                                    </span>
                                </li>
                                <li className={s.featureBenefit}>
                                    <Check size={16} />
                                    <span>
                                        Hosted SSH agent relay
                                        <small>
                                            Approve SSH logins on up to 25 Linux
                                            and macOS machines without running
                                            your own relay.
                                        </small>
                                    </span>
                                </li>
                                <li className={s.featureBenefit}>
                                    <Check size={16} />
                                    <span>
                                        Online Services device management
                                        <small>
                                            Manage registered devices, view and
                                            control their linking relationships,
                                            and revoke their access to Online
                                            Services.
                                        </small>
                                    </span>
                                </li>
                            </ul>
                            <div className={s.planNote}>
                                <strong>
                                    Same P2P model. Less infrastructure to run.
                                </strong>
                                <p>
                                    Both devices must be online. You initiate
                                    synchronization. Backups are stored
                                    separately as encrypted copies.
                                </p>
                            </div>
                            <small>
                                No voluntary subscription refunds. Your
                                statutory consumer rights and applicable
                                Stripe/Link or Google Play refund terms are
                                unaffected.
                            </small>
                        </>
                    )}
                </article>
            </div>
        </div>
    );
}
