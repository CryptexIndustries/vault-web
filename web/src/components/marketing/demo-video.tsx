import { useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
import s from "@/styles/Marketing.module.css";

const VIDEO_ID = "aJPGV25K-bs";
const TITLE = "Cryptex Vault demo";
export const DEMO_DURATION = "1:46";

/**
 * Click-to-load YouTube embed. Until the visitor presses play, the page shows
 * a self-hosted poster and makes no requests to YouTube. The player itself
 * comes from youtube-nocookie.com, which skips cookies until playback starts.
 */
export function DemoVideo() {
    const [playing, setPlaying] = useState(false);
    return (
        <div className="relative aspect-[1.6] bg-[#0c0f16] max-[720px]:aspect-video">
            {playing ? (
                <iframe
                    className="absolute inset-0 h-full w-full border-0"
                    src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&playsinline=1`}
                    title={TITLE}
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                />
            ) : (
                <button
                    className="group absolute inset-0 h-full w-full border-0 bg-transparent p-0"
                    onClick={() => setPlaying(true)}
                    aria-label={`Play ${TITLE} (${DEMO_DURATION}), loads from YouTube`}
                >
                    {/* The ! overrides the walkthrough's screenshot styles. */}
                    <Image
                        className="!aspect-auto !h-full !bg-transparent object-contain opacity-[0.55] !shadow-none transition-opacity group-hover:opacity-75 group-focus-visible:opacity-75"
                        src="/images/demo/poster.webp"
                        alt=""
                        unoptimized
                        width={1280}
                        height={720}
                        sizes="(max-width: 720px) 100vw, 80vw"
                    />
                    <span className="absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 whitespace-nowrap bg-[var(--coral)] px-[26px] py-4 text-[15px] font-medium text-[var(--navy)] shadow-[0_10px_40px_#0008] max-[720px]:gap-[9px] max-[720px]:px-4 max-[720px]:py-[11px] max-[720px]:text-[13px]">
                        <Play size={22} aria-hidden="true" />
                        Play demo
                        <b className="font-mono text-[11px] font-normal tracking-[0.08em] opacity-75">
                            {DEMO_DURATION}
                        </b>
                    </span>
                    <span
                        className={`${s.expandHint} !bottom-auto top-[15px] max-[720px]:!hidden`}
                    >
                        Loads from YouTube when you press play
                    </span>
                </button>
            )}
        </div>
    );
}
