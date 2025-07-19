import dynamic from 'next/dynamic';

const BarcodeScanner = dynamic(
  () => import('react-qr-barcode-scanner'),
  { ssr: false }    // IMPORTANT: disable SSR
);

export { BarcodeFormat } from "@zxing/library";

export default BarcodeScanner;