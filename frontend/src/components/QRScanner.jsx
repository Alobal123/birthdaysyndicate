import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useId } from "react";

export default function QRScanner({ onScan, onError }) {
  const scannerId = useId().replace(/:/g, "");

  useEffect(() => {
    let stopped = false;
    let handling = false;
    const scanner = new Html5Qrcode(scannerId);

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        async (decodedText) => {
          if (handling || stopped) {
            return;
          }
          handling = true;
          // Keep scanning until a decode is actually accepted by the page.
          const accepted = await Promise.resolve(onScan(decodedText));
          if (accepted && !stopped) {
            stopped = true;
            scanner.stop().catch(() => {});
          }
          handling = false;
        },
        () => {}
      )
      .catch((err) => {
        const message = err?.message || "Could not start camera scanner.";
        if (onError) {
          onError(message);
        }
      });

    return () => {
      stopped = true;
      scanner.stop().catch(() => {});
      scanner.clear().catch(() => {});
    };
  }, [onScan, scannerId]);

  return <div id={scannerId} className="panel overflow-hidden p-2" />;
}
