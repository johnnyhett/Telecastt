import { QRCodeSVG } from 'qrcode.react';
import { buildClientUrl } from '../lib/env';

interface QRPanelProps {
  localIp: string;
  roomId: string;
  ready: boolean;
}

export default function QRPanel({ localIp, roomId, ready }: QRPanelProps) {
  const joinUrl = buildClientUrl(localIp, roomId);
  return (
    <div className="qr-panel">
      <div className={`qr-frame ${ready ? 'is-ready' : ''}`}>
        <QRCodeSVG
          value={joinUrl}
          size={188}
          level="H"
          marginSize={1}
          imageSettings={{
            src: '/assets/logo.png',
            height: 38,
            width: 38,
            excavate: true,
          }}
        />
      </div>
      <p className="qr-hint">Scan to connect an extended display</p>
    </div>
  );
}
