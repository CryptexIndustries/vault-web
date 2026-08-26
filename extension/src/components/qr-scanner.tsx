import { lazy, Suspense, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { IScannerProps, IDetectedBarcode } from "@yudiel/react-qr-scanner";
import {
    handleChunkedQRCodeUpdate,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
    type ChunkedQRCodeScanResult,
} from "@ui/lib/chunked-qr";
import { locateZXingWasmFile } from "../utils/zxing-wasm";

const QR_SCAN_FORMATS = ["qr_code"] as NonNullable<IScannerProps["formats"]>;

const LazyScanner = lazy(() =>
    import("@yudiel/react-qr-scanner").then((module) => {
        module.prepareZXingModule({
            overrides: {
                locateFile: locateZXingWasmFile,
            },
        });
        return { default: module.Scanner };
    }),
);

type QRScannerResult = ChunkedQRCodeScanResult;
type BarcodeScannerProps = Omit<IScannerProps, "onScan" | "onError"> & {
    onUpdate?: (error: unknown, result?: QRScannerResult | null) => void;
    onChunkProgress?: (progress: ChunkedQRCodeProgress | null) => void;
    onError?: (error: unknown) => void;
};

const Fallback = () => (
    <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading camera…
    </div>
);

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
    onUpdate,
    onChunkProgress,
    onError,
    formats = QR_SCAN_FORMATS,
    ...props
}) => {
    const chunkStateRef = useRef<ChunkedQRCodeCollectorState | null>(null);

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
            onChunkProgress,
            onStateChange: (state) => {
                chunkStateRef.current = state;
            },
        });
    };

    return (
        <Suspense fallback={<Fallback />}>
            <LazyScanner
                {...props}
                formats={formats}
                onScan={handleScan}
                onError={onError}
            />
        </Suspense>
    );
};

export default BarcodeScanner;
