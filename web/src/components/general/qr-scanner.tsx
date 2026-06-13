import dynamic from "next/dynamic";
import { useRef } from "react";
import {
    CHUNKED_QR_PREFIX,
    collectChunkedQRCodeFrame,
    parseChunkedQRCodeFrame,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
} from "@/lib/chunked-qr";

const RawBarcodeScanner = dynamic(
    () => import("react-qr-barcode-scanner"),
    { ssr: false }, // IMPORTANT: disable SSR
);

type QRScannerResult = {
    getText: () => string;
};

type BarcodeScannerProps = {
    onUpdate?: (error: unknown, result?: QRScannerResult | null) => void;
    onError?: (error: unknown) => void;
    onChunkProgress?: (progress: ChunkedQRCodeProgress | null) => void;
    [key: string]: unknown;
};

export default function BarcodeScanner({
    onUpdate,
    onChunkProgress,
    ...props
}: BarcodeScannerProps) {
    const chunkStateRef = useRef<ChunkedQRCodeCollectorState | null>(null);

    const handleUpdate = (error: unknown, result?: QRScannerResult | null) => {
        if (!result) {
            onUpdate?.(error, result);
            return;
        }

        const text = result.getText();
        const frame = parseChunkedQRCodeFrame(text);
        if (!frame) {
            if (text.startsWith(`${CHUNKED_QR_PREFIX}:`)) {
                onUpdate?.(error, null);
                return;
            }
            chunkStateRef.current = null;
            onChunkProgress?.(null);
            onUpdate?.(error, result);
            return;
        }

        void collectChunkedQRCodeFrame(chunkStateRef.current, frame)
            .then(({ state, progress, payload }) => {
                chunkStateRef.current = state;
                onChunkProgress?.(progress);
                if (!payload) {
                    onUpdate?.(error, null);
                    return;
                }

                chunkStateRef.current = null;
                onUpdate?.(error, {
                    ...result,
                    getText: () => payload,
                });
            })
            .catch((chunkError) => {
                chunkStateRef.current = null;
                onChunkProgress?.(null);
                onUpdate?.(chunkError, null);
            });
    };

    return <RawBarcodeScanner {...props} onUpdate={handleUpdate} />;
}
