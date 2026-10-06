import { useState } from "react";
import s from "@/styles/Architecture.module.css";

type Mode = "local" | "self" | "online";

function Box({
    x,
    y,
    width = 220,
    title,
    detail,
}: {
    x: number;
    y: number;
    width?: number;
    title: string;
    detail: string;
}) {
    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={68}
                rx={6}
                className={s.box}
            />
            <text
                x={x + width / 2}
                y={y + 27}
                textAnchor="middle"
                className={s.title}
            >
                {title}
            </text>
            <text
                x={x + width / 2}
                y={y + 48}
                textAnchor="middle"
                className={s.detail}
            >
                {detail}
            </text>
        </g>
    );
}
function Path({ d, setup = false }: { d: string; setup?: boolean }) {
    return <path d={d} className={setup ? s.setup : s.transfer} />;
}
const descriptions: Record<Mode, string> = {
    local: "The client reads and writes its encrypted vault on this device. No Online Services account or synchronization server is needed for local vault operations.",
    self: "Your signaling and STUN services help clients establish a connection. Vault records travel directly between clients, or through your TURN relay when a direct route is unavailable. Both clients need to be online and unlocked. No Online Services account is required.",
    online: "Managed signaling, STUN, and TURN provide the connection services. The account API authorizes access and issues temporary backup-storage URLs. Clients upload encrypted snapshots to storage separately from live device synchronization.",
};

export function ArchitectureOverview() {
    const [mode, setMode] = useState<Mode>("local");
    const networked = mode !== "local";
    return (
        <div className={s.overview}>
            <div
                className={s.selector}
                role="group"
                aria-label="Architecture view"
            >
                {(
                    [
                        ["local", "Local only"],
                        ["self", "Self-hosted sync"],
                        ["online", "Online Services"],
                    ] as const
                ).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={mode === value}
                        aria-controls="system-diagram"
                        onClick={() => setMode(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <figure id="system-diagram" className={s.figure}>
                <div id="diagram-scroll-hint" className={s.scrollHint}>
                    <span aria-hidden="true">↔</span> Scroll to explore
                </div>
                <div
                    className={`${s.scroll} overflow-x-auto pb-1 pt-5`}
                    tabIndex={0}
                    role="region"
                    aria-label="System diagram"
                    aria-describedby="diagram-scroll-hint"
                >
                    <svg
                        viewBox={
                            "0 0 720 " +
                            (mode === "online" ? 630 : networked ? 445 : 230)
                        }
                        className={s.diagram}
                        role="img"
                        aria-labelledby="system-map-title system-map-description"
                    >
                        <title id="system-map-title">
                            {mode === "local"
                                ? "Local vault architecture"
                                : mode === "self"
                                  ? "Self-hosted synchronization architecture"
                                  : "Architecture with Online Services"}
                        </title>
                        <desc id="system-map-description">
                            {descriptions[mode]} Each client has its own
                            encrypted local storage. Dashed lines show
                            connection setup and authorization; solid lines show
                            vault data transfers. Arrowheads indicate direction.
                        </desc>
                        <defs>
                            <marker
                                id="architecture-arrow"
                                markerWidth="7"
                                markerHeight="7"
                                refX="5"
                                refY="3.5"
                                orient="auto-start-reverse"
                            >
                                <path
                                    d="M0,0 L6,3.5 L0,7"
                                    fill="currentColor"
                                />
                            </marker>
                        </defs>
                        <rect
                            x={10}
                            y={10}
                            width={240}
                            height={202}
                            rx={8}
                            className={s.device}
                        />
                        {networked ? (
                            <rect
                                x={470}
                                y={10}
                                width={240}
                                height={202}
                                rx={8}
                                className={s.device}
                            />
                        ) : null}
                        <Box
                            x={20}
                            y={20}
                            title="Device A: vault client"
                            detail="Web app or extension"
                        />
                        <Path d="M130 88 V128" />
                        <Box
                            x={20}
                            y={132}
                            title="Local encrypted vault"
                            detail="This installation's storage"
                        />
                        {networked ? (
                            <>
                                <Box
                                    x={480}
                                    y={20}
                                    title="Device B: vault client"
                                    detail="Web app or extension"
                                />
                                <Path d="M590 88 V128" />
                                <Box
                                    x={480}
                                    y={132}
                                    title="Local encrypted vault"
                                    detail="This installation's storage"
                                />
                                <Path d="M245 53 H475" />
                                <text
                                    x={360}
                                    y={36}
                                    textAnchor="middle"
                                    className={s.detail}
                                >
                                    Encrypted peer exchange
                                </text>
                                <text
                                    x={360}
                                    y={78}
                                    textAnchor="middle"
                                    className={s.detail}
                                >
                                    Direct WebRTC connection
                                </text>
                                <Path d="M105 212 V267 H215" setup />
                                <Path d="M615 212 V267 H505" setup />
                                <Box
                                    x={220}
                                    y={233}
                                    width={280}
                                    title={
                                        mode === "self"
                                            ? "Your signaling + STUN"
                                            : "Managed signaling + STUN"
                                    }
                                    detail="Connection setup"
                                />
                                <Path d="M80 212 V377 H215" />
                                <Path d="M640 212 V377 H505" />
                                <Box
                                    x={220}
                                    y={343}
                                    width={280}
                                    title={
                                        mode === "self"
                                            ? "Your TURN relay"
                                            : "Managed TURN relay"
                                    }
                                    detail="Encrypted peer traffic, if needed"
                                />
                                {mode === "online" ? (
                                    <>
                                        <Path d="M55 212 V483 H215" setup />
                                        <Path d="M665 212 V483 H505" setup />
                                        <Box
                                            x={220}
                                            y={449}
                                            width={280}
                                            title="Online Services API"
                                            detail="Account and access authorization"
                                        />
                                        <Path d="M30 212 V585 H215" />
                                        <Path d="M690 212 V585 H505" />
                                        <Box
                                            x={220}
                                            y={551}
                                            width={280}
                                            title="Encrypted backup storage"
                                            detail="Snapshot upload / download"
                                        />
                                    </>
                                ) : null}
                            </>
                        ) : null}
                    </svg>
                </div>
                {networked ? (
                    <div className="mb-4 mt-2 flex flex-wrap gap-x-6 gap-y-2.5 text-[11px] text-[var(--soft)]">
                        <span className="flex items-center gap-2">
                            <i className="w-6 border-t-2 border-t-[var(--coral)]" />
                            Vault data
                        </span>
                        <span className="flex items-center gap-2">
                            <i className="w-6 border-t-2 border-dashed border-t-[var(--soft)]" />
                            Setup / authorization
                        </span>
                    </div>
                ) : null}
                <figcaption>
                    {descriptions[mode]}
                    {mode === "online"
                        ? " Stored backups do not deliver missed changes to offline devices."
                        : ""}
                </figcaption>
            </figure>
        </div>
    );
}

export function ClientArchitecture({
    variant,
}: {
    variant: "web" | "extension";
}) {
    const web = variant === "web";
    if (!web)
        return (
            <figure
                className={s.clientFigure}
                aria-label="Extension components"
            >
                <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
                    <div className={s.clientNode}>
                        <strong>Extension pages</strong>
                        <span>Popup, linking, live peer connections</span>
                    </div>
                    <div className={s.clientNode}>
                        <strong>Website integration</strong>
                        <span>Content scripts and autofill frames</span>
                    </div>
                </div>
                <div className={s.connector}>
                    <span aria-hidden="true">↕</span>Request / response messages
                    from each context
                </div>
                <div className={s.clientNode}>
                    <strong>Service worker + shared core</strong>
                    <span>Message routing, vault operations, persistence</span>
                </div>
                <div className={s.connector}>
                    <span aria-hidden="true">↕</span>Read / write separate
                    stores
                </div>
                <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
                    <div className={s.clientNode}>
                        <strong>IndexedDB</strong>
                        <span>Encrypted vault records on disk</span>
                    </div>
                    <div className={s.clientNode}>
                        <strong>Session storage</strong>
                        <span>
                            Unlocked state and active key material in memory
                        </span>
                    </div>
                </div>
                <figcaption>
                    The worker manages vault state. Extension pages run the
                    interface and live peer connections; website scripts handle
                    field interaction.
                </figcaption>
            </figure>
        );
    const nodes = [
        ["Browser page", "Vault interface and unlocked state"],
        [
            "Vault operations + shared core",
            "Queued changes, serialization, encryption",
        ],
        ["IndexedDB", "Encrypted vault record on this device"],
    ];
    return (
        <figure
            className={s.clientFigure}
            aria-label="Web application components"
        >
            {nodes.map(([title, detail], index) => (
                <div key={title}>
                    {index > 0 ? (
                        <div className={s.connector}>
                            <span aria-hidden="true">↕</span>
                            {index === 1
                                ? "Read / change vault state"
                                : "Load / persist"}
                        </div>
                    ) : null}
                    <div className={s.clientNode}>
                        <strong>{title}</strong>
                        <span>{detail}</span>
                    </div>
                </div>
            ))}
            <figcaption>
                All three components run on the user's device. Saving finishes
                before the interface receives the updated vault state.
            </figcaption>
        </figure>
    );
}
