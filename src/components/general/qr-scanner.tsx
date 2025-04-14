import { useEffect, useRef } from "react";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import type { Result } from "@zxing/library";

interface QrReaderProps {
    className?: string;
    disabled?: boolean;
    scanDelay?: number;
    onResult?: (result?: Result, error?: Error) => void;
    mediaTrackConstraints?: MediaTrackConstraints;
}

export default function QrReader({
    className = "",
    disabled = false,
    scanDelay = 500,
    onResult = () => {
        // No-op
    },
    mediaTrackConstraints = {
        facingMode: {
            ideal: "environment",
        },
    },
}: QrReaderProps) {
    const controlRef = useRef<IScannerControls | null>(null);
    const readerRef = useRef<BrowserQRCodeReader | null>(null);
    const videoElementRef = useRef<HTMLVideoElement>(null);

    const startScanning = () => {
        // Only start scanning if we haven't already started
        if (!readerRef.current && !controlRef.current) {
            readerRef.current = new BrowserQRCodeReader(undefined, {
                delayBetweenScanAttempts: scanDelay,
            });

            console.debug("QRScanner: start called");

            readerRef.current
                .decodeFromConstraints(
                    {
                        audio: false,
                        video: mediaTrackConstraints,
                    },
                    videoElementRef.current ?? undefined,
                    (result, error) => {
                        onResult(result, error);
                    }
                )
                .then(
                    (controls: IScannerControls) =>
                        (controlRef.current = controls)
                )
                .catch((error: Error) => {
                    console.warn(error);
                });
        }
    };

    const stopScanning = () => {
        console.debug("QRScanner: stop called");

        videoElementRef.current?.setMediaKeys;

        controlRef.current?.stop();
        controlRef.current = null;

        readerRef.current = null;
    };

    // We don't actually destroy the component, we just hide it
    const componentClass = disabled ? "hidden" : className;

    useEffect(() => {
        if (!disabled) {
            startScanning();
        }

        return () => {
            stopScanning();
        };
    }, [disabled]);

    return (
        <section className={componentClass}>
            <video ref={videoElementRef}></video>
        </section>
    );
}
