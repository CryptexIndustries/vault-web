import { lazy, Suspense, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
    handleChunkedQRCodeUpdate,
    type ChunkedQRCodeCollectorState,
    type ChunkedQRCodeProgress,
    type ChunkedQRCodeScanResult,
} from "@ui/lib/chunked-qr";

const LazyBarcodeScanner = lazy(() => import("react-qr-barcode-scanner"));

type BarcodeScannerComponent =
    typeof import("react-qr-barcode-scanner").default;
type RawBarcodeScannerProps = React.ComponentProps<BarcodeScannerComponent>;
type QRScannerResult = ChunkedQRCodeScanResult;
type BarcodeScannerProps = Omit<RawBarcodeScannerProps, "onUpdate"> & {
    onUpdate?: (error: unknown, result?: QRScannerResult | null) => void;
    onChunkProgress?: (progress: ChunkedQRCodeProgress | null) => void;
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
    ...props
}) => {
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

    return (
        <Suspense fallback={<Fallback />}>
            <LazyBarcodeScanner
                {...props}
                onUpdate={handleUpdate as RawBarcodeScannerProps["onUpdate"]}
            />
        </Suspense>
    );
};

export default BarcodeScanner;
