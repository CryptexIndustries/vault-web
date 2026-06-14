import dynamic from "next/dynamic";
import { useRef } from "react";
import {
    handleChunkedQRCodeUpdate,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
    type ChunkedQRCodeScanResult,
} from "@ui/lib/chunked-qr";

const RawBarcodeScanner = dynamic(
    () => import("react-qr-barcode-scanner"),
    { ssr: false }, // IMPORTANT: disable SSR
);

type QRScannerResult = ChunkedQRCodeScanResult;

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
        handleChunkedQRCodeUpdate({
            currentState: chunkStateRef.current,
            error,
            result,
            onUpdate,
            onChunkProgress,
            onStateChange: (state) => {
                chunkStateRef.current = state;
            },
        });
    };

    return <RawBarcodeScanner {...props} onUpdate={handleUpdate} />;
}
