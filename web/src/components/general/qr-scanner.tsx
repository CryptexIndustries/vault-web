import dynamic from "next/dynamic";
import { useRef } from "react";
import {
    type IScannerProps,
    type IDetectedBarcode,
    prepareZXingModule,
} from "@yudiel/react-qr-scanner";

import {
    handleChunkedQRCodeUpdate,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
    type ChunkedQRCodeScanResult,
} from "@ui/lib/chunked-qr";

const QR_SCAN_FORMATS = ["qr_code"] as NonNullable<IScannerProps["formats"]>;

const RawScanner = dynamic(
    () => import("@yudiel/react-qr-scanner").then((module) => module.Scanner),
    { ssr: false }, // IMPORTANT: disable SSR
);

type QRScannerResult = ChunkedQRCodeScanResult;

type BarcodeScannerProps = Omit<IScannerProps, "onScan" | "onError"> & {
    onUpdate?: (error: unknown, result?: QRScannerResult | null) => void;
    onError?: (error: unknown) => void;
    onChunkProgress?: (progress: ChunkedQRCodeProgress | null) => void;
};

prepareZXingModule({
    overrides: {
        locateFile: (path: string, prefix: string) => {
            if (path.endsWith(".wasm")) {
                return "/wasm-libs/zxing_reader.wasm";
            }
            return prefix + path;
        },
    },
});

export default function BarcodeScanner({
    onUpdate,
    onChunkProgress,
    onError,
    formats = QR_SCAN_FORMATS,
    ...props
}: BarcodeScannerProps) {
    const chunkStateRef = useRef<ChunkedQRCodeCollectorState | null>(null);
    const progressRef = useRef<{ received: number; total: number } | null>(
        null,
    );

    const handleScan: IScannerProps["onScan"] = (
        detectedCodes: IDetectedBarcode[],
    ) => {
        const detected = detectedCodes[0];
        if (!detected) {
            return;
        }

        const result: QRScannerResult = {
            getText: () => detected.rawValue,
        };
        handleChunkedQRCodeUpdate({
            currentState: chunkStateRef.current,
            error: null,
            result,
            onUpdate,
            onChunkProgress: (p) => {
                if (p)
                    progressRef.current = {
                        received: p.received,
                        total: p.total,
                    };
                onChunkProgress?.(p);
            },
            onStateChange: (state) => {
                chunkStateRef.current = state;
            },
        });
    };

    const highlightCodeOnCanvas = (
        detectedCodes: IDetectedBarcode[],
        ctx: CanvasRenderingContext2D,
    ) => {
        detectedCodes.forEach((detectedCode: IDetectedBarcode) => {
            const { boundingBox } = detectedCode;

            // Fill bounding box proportional to QR chunks scanned
            if (progressRef.current && progressRef.current.total > 0) {
                const { received, total } = progressRef.current;
                const fillHeight = (received / total) * boundingBox.height;
                ctx.fillStyle = "rgba(0, 255, 0, 0.25)";
                ctx.fillRect(
                    boundingBox.x,
                    boundingBox.y + boundingBox.height - fillHeight,
                    boundingBox.width,
                    fillHeight,
                );
            }

            // Draw bounding box
            ctx.strokeStyle = "#00FF00";
            ctx.lineWidth = 4;
            ctx.strokeRect(
                boundingBox.x,
                boundingBox.y,
                boundingBox.width,
                boundingBox.height,
            );
        });
    };

    return (
        <RawScanner
            components={{
                tracker: highlightCodeOnCanvas,
            }}
            sound={""}
            {...props}
            formats={formats}
            onScan={handleScan}
            onError={onError}
        />
    );
}
