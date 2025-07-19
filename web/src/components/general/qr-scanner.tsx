import dynamic from "next/dynamic";

const BarcodeScanner = dynamic(
    () => import("react-qr-barcode-scanner"),
    { ssr: false }, // IMPORTANT: disable SSR
);

export default BarcodeScanner;

