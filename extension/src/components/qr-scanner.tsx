import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const LazyBarcodeScanner = lazy(() => import("react-qr-barcode-scanner"));

type BarcodeScannerComponent =
    typeof import("react-qr-barcode-scanner").default;
type BarcodeScannerProps = React.ComponentProps<BarcodeScannerComponent>;

const Fallback = () => (
    <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading camera…
    </div>
);

const BarcodeScanner: React.FC<BarcodeScannerProps> = (props) => (
    <Suspense fallback={<Fallback />}>
        <LazyBarcodeScanner {...props} />
    </Suspense>
);

export default BarcodeScanner;
