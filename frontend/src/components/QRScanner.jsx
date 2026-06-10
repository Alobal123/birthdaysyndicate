import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useId } from "react";

export default function QRScanner({ onScan }) {
  const scannerId = useId().replace(/:/g, "");

  useEffect(() => {
    const scanner = new Html5Qrcode(scannerId);

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decodedText) => {
          onScan(decodedText);
          scanner.stop().catch(() => {});
        },
        () => {}
      )
      .catch(() => {});

    return () => {
      scanner.stop().catch(() => {});
      scanner.clear().catch(() => {});
    };
  }, [onScan, scannerId]);

  return <div id={scannerId} className="panel overflow-hidden p-2" />;
}
