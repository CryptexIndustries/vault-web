import { NextPage } from "next";
import Link from "next/link";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";

import PageFooter from "@/components/general/footer";
import HTMLHeader from "@/components/html-header";
import HTMLMain from "@/components/html-main";

import { Body, Footer, GenericModal } from "@/components/general/modal";
import NotificationContainer from "@/components/general/notification-container";
import Spinner from "@/components/general/spinner";
import ContactUsForm from "@/components/index/contact-us-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    ArrowRight,
    Code,
    Database,
    HelpCircle,
    Loader2,
    Lock,
    Server,
    Shield,
    Users,
    Wifi,
    Zap,
} from "lucide-react";

const Index: NextPage = ({}) => {
    const contactUsModalVisibility = useState(false);
    const contactUsModalSubmitting = useState(false);

    const showContactUsModal = () => contactUsModalVisibility[1](true);
    const hideContactUsModal = () => contactUsModalVisibility[1](false);
    const contactUsSubmitBtnRef = useRef<HTMLButtonElement>(null);

    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Decentralized Password Manager"
                description="No need to depend on any service that holds your passwords, secrets or other credentials."
            />

            <HTMLMain>
                <FrontPage />
                <PageFooter>
                    <div
                        id="section-contact"
                        className="mb-4 flex w-full flex-col justify-around pt-10 sm:flex-row"
                    >
                        <div>
                            <h1 className="text-4xl font-bold text-slate-200">
                                Get in touch
                            </h1>
                            <p className="mt-1 text-slate-300">
                                Feel free to contact us for any questions or to
                                learn more about our service.
                            </p>
                        </div>
                        <div className="mt-4 flex flex-col justify-center gap-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                            <Button
                                variant="secondary"
                                onClick={showContactUsModal}
                            >
                                Contact us
                            </Button>
                            <div>
                                <p className="text-slate-300">
                                    We care about the protection of your data.
                                    <br /> Read our {""}
                                    <Link
                                        href="/privacy"
                                        className="font-bold underline"
                                    >
                                        Privacy Policy
                                    </Link>
                                    .
                                </p>
                            </div>
                        </div>
                    </div>
                </PageFooter>
            </HTMLMain>
            <GenericModal
                key="contact-us-modal"
                visibleState={contactUsModalVisibility}
            >
                <Body>
                    <div className="flex flex-col items-center text-center">
                        <h1 className="text-2xl font-bold text-gray-900">
                            Contact us
                        </h1>

                        <p className="mt-2 text-slate-700">
                            Feel free to contact us for any questions or to
                            learn more about our service.
                        </p>
                        <Suspense fallback={<Spinner />}>
                            <ContactUsForm
                                hideModalFn={hideContactUsModal}
                                submitButtonRef={contactUsSubmitBtnRef}
                                submittingState={contactUsModalSubmitting}
                            />
                        </Suspense>
                    </div>
                </Body>

                <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                    <Button
                        className="sm:ml-2"
                        onClick={() => contactUsSubmitBtnRef.current?.click()}
                        disabled={contactUsModalSubmitting[0]}
                        type="submit"
                    >
                        {contactUsModalSubmitting[0] && (
                            <Loader2 className="animate-spin" />
                        )}
                        Send
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={hideContactUsModal}
                        type="button"
                    >
                        Close
                    </Button>
                </Footer>
            </GenericModal>
            <NotificationContainer />
        </>
    );
};

const FrontPage: React.FC = () => {
    return (
        <div className="relative min-h-screen overflow-x-hidden bg-primary text-[#F5F7FA]">
            <BackgroundEffects />

            <div className="z-50 overflow-hidden backdrop-blur-sm">
                <section className="flex h-dvh flex-col items-center justify-evenly">
                    <div className="flex flex-grow flex-col justify-center text-center">
                        {/* <Image */}
                        {/*     src="/images/logo/cryptex-logo-new.svg" */}
                        {/*     alt="Cryptex Logo" */}
                        {/*     width={600} */}
                        {/*     height={50} */}
                        {/*     priority={true} */}
                        {/*     className="select-none" */}
                        {/* /> */}
                        <CryptexVaultLogo />

                        <div className="mt-5">
                            <p>Decentralized Password Management</p>
                            <div className="flex w-full flex-row items-center justify-center gap-3">
                                <p>Your Data.</p>
                                <p>Your Devices.</p>
                                <p>Fully Encrypted.</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex max-h-64 flex-grow">
                        <Link
                            href="/app"
                            className="animate-pulse overflow-hidden font-mono font-medium uppercase text-slate-300 hover:text-slate-400"
                        >
                            unlock
                            <div className="animate-underline-activate border bg-foreground"></div>
                        </Link>
                    </div>
                    <div className="flex flex-col items-center justify-end pb-10">
                        <div className="flex flex-col items-center gap-1">
                            <div className="h-2 w-[0.5px] animate-line-appear-loop bg-slate-600 opacity-0 delay-0"></div>
                            <div className="h-2 w-[0.5px] animate-line-appear-loop bg-slate-600 opacity-0 delay-200"></div>
                            <div className="h-0 w-0 animate-line-appear-loop border-l-[8px] border-r-[8px] border-t-[8px] border-transparent border-t-slate-600 opacity-0 delay-500"></div>
                        </div>
                    </div>
                </section>

                <WhyWhatHowSection />
                <CTASection />
            </div>
        </div>
    );
};

export default Index;

const CryptexVaultLogo = () => {
    const svgRef = useRef<SVGSVGElement>(null);

    return (
        <div className="relative h-full max-h-[120px] w-full max-w-[600px]">
            <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 650 90"
                className="block"
                style={{ width: "100%", height: "100%" }}
            >
                <defs>
                    <style>{`
          .base {
            font-family: '', sans-serif;
            font-size: 72px;
            letter-spacing: 2px;
          }
          .glow {
            filter: url(#glow);
          }
          .primary { fill: #FF5668; }
          .secondary { fill: #25C472; }
          .tertiary { fill: #FCF8EC; }
        `}</style>

                    {/* Dual‐color glow filter */}
                    <filter
                        id="glow"
                        x="-50%"
                        y="-50%"
                        width="200%"
                        height="200%"
                    >
                        {/* Tertiary outer glow */}
                        <feFlood floodColor="#FCF8EC" result="f1" />
                        <feComposite
                            in="f1"
                            in2="SourceAlpha"
                            operator="in"
                            result="m1"
                        />
                        <feGaussianBlur in="m1" stdDeviation="5" result="b1" />
                        {/* Secondary inner glow */}
                        <feGaussianBlur
                            in="SourceAlpha"
                            stdDeviation="1"
                            result="b2"
                        />
                        <feMerge>
                            <feMergeNode in="b1" />
                            <feMergeNode in="b2" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <g>
                    {/* "CRYTPEX" with flicker */}
                    <text
                        className="base glow tertiary animate-flicker-short"
                        x="10"
                        y="50"
                    >
                        CRYPTEX
                    </text>

                    <line
                        x1="355"
                        y1="99"
                        x2="415"
                        y2="1"
                        className="glow secondary"
                        stroke="black"
                        strokeWidth="4"
                    />

                    {/* "VAULT" with flicker */}
                    <text
                        className="base glow primary animate-flicker"
                        x="410"
                        y="100"
                    >
                        VAULT
                    </text>
                </g>
            </svg>
        </div>
    );
};

type Point = { x: number; y: number; vx: number; vy: number };
type Link = { a: Point; b: Point; start: number; duration: number };

const useCustomBackground = (
    width: number,
    height: number,
    pointCount = 50,
) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let points: Point[] = [];
        let links: Link[] = [];

        let animationId: number;
        let intervalId1: number = 0;
        let intervalId2: number = 0;

        // Initialize random points
        points = Array.from({ length: pointCount }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
        }));

        // Regular ephemeral pair links
        intervalId1 = window.setInterval(() => {
            const [a, b] = [
                points[Math.floor(Math.random() * points.length)],
                points[Math.floor(Math.random() * points.length)],
            ];
            if (a && b)
                links.push({ a, b, start: performance.now(), duration: 500 });
        }, 1000);

        // Link one pivot to all others at random intervals
        intervalId2 = window.setInterval(
            () => {
                const pivot = points[Math.floor(Math.random() * points.length)];
                const now = performance.now();

                // Random 3 points from the list
                const randomPoints = points.filter((_, i) => i % 3 === 0);
                for (const p of randomPoints.slice(0, 5)) {
                    if (p !== pivot && pivot) {
                        links.push({
                            a: pivot,
                            b: p,
                            start: now,
                            duration: 800,
                        });
                    }
                }
            },
            7000 + Math.random() * 10000,
        );

        // Animation loop
        const draw = () => {
            ctx.clearRect(0, 0, width, height);

            // Move & draw points with glow
            for (const p of points) {
                p.x += p.vx / 3.9;
                p.y += p.vy / 3.9;
                if (p.x < 0 || p.x > width) p.vx *= -1;
                if (p.y < 0 || p.y > height) p.vy *= -1;

                ctx.beginPath();
                ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI); // draw point :contentReference[oaicite:3]{index=3}
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.shadowColor = "#25c472";
                ctx.shadowBlur = 10;
                ctx.fill();
            }

            // Draw & fade links
            const now = performance.now();
            links = links.filter((link) => now - link.start < link.duration); // clear expired :contentReference[oaicite:4]{index=4}
            for (const { a, b, start, duration } of links) {
                const t = (now - start) / duration;
                ctx.globalAlpha = 1 - t;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineWidth = 1;
                ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            animationId = window.requestAnimationFrame(draw); // smooth frames :contentReference[oaicite:5]{index=5}
        };
        draw();

        // Cleanup on unmount
        return () => {
            window.cancelAnimationFrame(animationId); // cancel loop :contentReference[oaicite:6]{index=6}
            window.clearInterval(intervalId1); // clear pair timer :contentReference[oaicite:7]{index=7}
            window.clearInterval(intervalId2); // clear pivot timer :contentReference[oaicite:8]{index=8}
        };
    }, [width, height, pointCount]);

    return canvasRef;
};

const BackgroundEffects = () => {
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const canvasRef = useCustomBackground(
        canvasSize.width,
        canvasSize.height,
        100,
    );

    // On resize, update the canvas size
    useLayoutEffect(() => {
        const updateSize = () => {
            const canvas = canvasRef.current;
            if (canvas) {
                const { width, height } = canvas.getBoundingClientRect();

                if (canvas.width !== width || canvas.height !== height) {
                    const { devicePixelRatio: ratio = 1 } = window;
                    const context = canvas.getContext("2d");
                    canvas.width = width * ratio;
                    canvas.height = height * ratio;
                    context?.scale(ratio, ratio);
                }
                setCanvasSize({
                    width: window.innerWidth,
                    height: window.innerHeight,
                });
            }
        };

        window.addEventListener("resize", updateSize);
        updateSize();

        return () => window.removeEventListener("resize", updateSize);
    }, [canvasRef]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute left-0 top-0 z-0"
            width={canvasSize.width}
            height={canvasSize.height}
        />
    );
};

export const WhyWhatHowSection = () => {
    return (
        <section className="pt-20 text-white">
            <div className="container mx-auto max-w-5xl px-4">
                <div className="mb-16 text-center">
                    <h1 className="mb-6 text-4xl font-bold md:text-5xl">
                        Some things are not for the cloud.
                    </h1>
                    <p className="mx-auto max-w-2xl text-xl text-zinc-400">
                        True privacy through local-first, peer-to-peer password
                        management.
                    </p>
                </div>

                <div className="space-y-24">
                    {/* Why Segment */}
                    <div className="space-y-8">
                        <div className="mb-8 flex items-center space-x-4">
                            <div className="rounded-full bg-zinc-800 p-2">
                                <HelpCircle className="color-brand-primary h-6 w-6" />
                            </div>
                            <h2 className="text-3xl font-bold">Why?</h2>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2">
                            <Card className="overflow-hidden border-0 bg-zinc-800/50 shadow-xl">
                                <div className="h-1 bg-[#ff5668]"></div>
                                <CardContent className="pt-6">
                                    <h3 className="mb-3 flex items-center text-xl font-semibold">
                                        <Lock className="color-brand-primary mr-2 h-5 w-5" />
                                        Security-First Approach
                                    </h3>
                                    <p className="text-zinc-300">
                                        Our users are security-savvy individuals
                                        who refuse to entrust their passwords to
                                        third-party servers. Local storage
                                        eliminates the exposure risks of
                                        cloud-hosted vaults by keeping
                                        everything on devices you control.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card className="overflow-hidden border-0 bg-zinc-800/50 shadow-xl">
                                <div className="h-1 bg-[#ff5668]"></div>
                                <CardContent className="pt-6">
                                    <h3 className="mb-3 flex items-center text-xl font-semibold">
                                        <Shield className="color-brand-primary mr-2 h-5 w-5" />
                                        Uncompromised Independence
                                    </h3>
                                    <p className="text-zinc-300">
                                        Centralized services can be compromised,
                                        shut down, or coerced, cutting off
                                        access to your own data. By removing our
                                        company as a potential failure point,
                                        you gain uninterrupted access and
                                        ironclad privacy.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* What Segment */}
                    <div className="space-y-8">
                        <div className="mb-8 flex items-center space-x-4">
                            <div className="rounded-full bg-zinc-800 p-2">
                                <Zap className="color-brand-primary h-6 w-6" />
                            </div>
                            <h2 className="text-3xl font-bold">What?</h2>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                            {[
                                {
                                    icon: (
                                        <Lock className="color-brand-primary h-5 w-5" />
                                    ),
                                    title: "Zero-Knowledge Architecture",
                                    description:
                                        "Encryption and decryption occur only on your devices—no master keys ever transit our servers.",
                                },
                                {
                                    icon: (
                                        <Wifi className="color-brand-primary h-5 w-5" />
                                    ),
                                    title: "WebRTC P2P Sync",
                                    description:
                                        "We leverage WebRTC's ICE framework for direct, encrypted peer-to-peer synchronization without storing any vault data centrally.",
                                },
                                {
                                    icon: (
                                        <Server className="color-brand-primary h-5 w-5" />
                                    ),
                                    title: "Transparent Relay",
                                    description:
                                        "For networks where direct peer-to-peer connectivity fails, we transparently relay traffic through TURN servers to maintain sync.",
                                },
                                {
                                    icon: (
                                        <Database className="color-brand-primary h-5 w-5" />
                                    ),
                                    title: "Optional Signaling",
                                    description:
                                        "An optional hosted signaling service removes the need to self-deploy STUN/TURN infrastructure, yet it never gains access to your encrypted vault.",
                                },
                            ].map((feature, index) => (
                                <div
                                    key={index}
                                    className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-6"
                                >
                                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700/50">
                                        {feature.icon}
                                    </div>
                                    <h3 className="mb-2 text-lg font-semibold">
                                        {feature.title}
                                    </h3>
                                    <p className="text-sm text-zinc-400">
                                        {feature.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* How Segment */}
                    <div className="space-y-8">
                        <div className="mb-8 flex items-center space-x-4">
                            <div className="rounded-full bg-zinc-800 p-2">
                                <Code className="color-brand-primary h-6 w-6" />
                            </div>
                            <h2 className="text-3xl font-bold">How?</h2>
                        </div>

                        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/20 p-8">
                            <div className="space-y-8">
                                {[
                                    {
                                        step: "01",
                                        title: "Local Vault Creation",
                                        description:
                                            "You initialize your encrypted vault on your device; a strong master password derives the encryption key locally.",
                                        icon: (
                                            <Lock className="color-brand-primary h-5 w-5" />
                                        ),
                                    },
                                    {
                                        step: "02",
                                        title: "Peer Discovery & Signaling",
                                        description:
                                            "Devices exchange connection info via STUN/TURN to negotiate a direct WebRTC link; signaling only facilitates connection setup, not data exchange.",
                                        icon: (
                                            <Wifi className="color-brand-primary h-5 w-5" />
                                        ),
                                    },
                                    {
                                        step: "03",
                                        title: "Direct Encrypted Sync",
                                        description:
                                            "Once peers are connected, vault changes replicate over an encrypted P2P channel, ensuring data never touches third-party servers.",
                                        icon: (
                                            <Shield className="color-brand-primary h-5 w-5" />
                                        ),
                                    },
                                    {
                                        step: "04",
                                        title: "Automatic Relay Fallback",
                                        description:
                                            "If a direct link can't form, we seamlessly switch to TURN relays so your devices stay in sync, even across restrictive networks.",
                                        icon: (
                                            <Server className="color-brand-primary h-5 w-5" />
                                        ),
                                    },
                                    {
                                        step: "05",
                                        title: "Resilient Independence",
                                        description:
                                            "No matter our company's status, your existing devices will continue syncing peer-to-peer without interruption.",
                                        icon: (
                                            <Users className="color-brand-primary h-5 w-5" />
                                        ),
                                    },
                                ].map((step, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start"
                                    >
                                        <div className="mr-4 rounded-full bg-zinc-800 p-2">
                                            {step.icon}
                                        </div>
                                        <div>
                                            <div className="flex items-center">
                                                <div className="color-brand-primary mr-3 font-mono text-sm">
                                                    {step.step}
                                                </div>
                                                <h3 className="text-xl font-semibold">
                                                    {step.title}
                                                </h3>
                                            </div>
                                            <p className="mt-2 text-zinc-400">
                                                {step.description}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

const CTASection = () => {
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const canvasRef = useCustomBackground(
        canvasSize.width,
        canvasSize.height,
        50,
    );

    const sectionRef = useRef<HTMLDivElement>(null);

    // On resize, update the canvas size
    useLayoutEffect(() => {
        const updateSize = () => {
            const canvas = canvasRef.current;
            const section = sectionRef.current;
            if (canvas && section) {
                const { width, height } = section.getBoundingClientRect();

                if (canvas.width !== width || canvas.height !== height) {
                    const { devicePixelRatio: ratio = 1 } = window;
                    const context = canvas.getContext("2d");
                    canvas.width = width * ratio;
                    canvas.height = height * ratio;
                    context?.scale(ratio, ratio);
                }
                setCanvasSize({
                    width: canvas.width,
                    height: canvas.height,
                });
            }
        };

        window.addEventListener("resize", updateSize);
        updateSize();

        return () => window.removeEventListener("resize", updateSize);
    }, [canvasRef]);

    return (
        <section ref={sectionRef} className="my-20 text-white">
            <canvas
                ref={canvasRef}
                className="absolute z-[-10] blur-md"
                width={canvasSize.width}
                height={canvasSize.height}
            />
            <div className="py-5 text-center">
                <Link href="/app" className="ml-2 h-4 w-4 text-center">
                    <Button
                        variant="secondary"
                        className="inline-flex flex-col gap-0 rounded-full px-8 py-3"
                    >
                        <div className="inline-flex items-center font-medium">
                            Secure Your Passwords
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </div>
                        <div className="w-full animate-underline-activate border bg-foreground"></div>
                    </Button>
                </Link>
                <p className="mt-4 text-sm text-slate-300">
                    No account required. Your data stays on your devices.
                </p>
            </div>
        </section>
    );
};
