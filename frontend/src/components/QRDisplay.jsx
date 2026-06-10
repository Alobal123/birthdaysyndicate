import { QRCodeCanvas } from "qrcode.react";

export default function QRDisplay({ url }) {
  return (
    <div className="panel flex flex-col items-center gap-3 p-5">
      <QRCodeCanvas value={url} size={220} bgColor="#ffffff" fgColor="#122023" level="H" includeMargin />
      <p className="max-w-[230px] text-center text-xs text-steel break-all">{url}</p>
    </div>
  );
}
