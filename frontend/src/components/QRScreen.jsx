import { QRCodeCanvas } from 'qrcode.react';
import { Smartphone, Wifi } from 'lucide-react';

export default function QRScreen({ qr, status }) {
    return (
        <div className="flex flex-col items-center justify-center h-screen bg-[#111b21] gap-8 px-4">
            {/* Header */}
            <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-[#00a884] flex items-center justify-center shadow-lg shadow-[#00a884]/30">
                    <Smartphone size={30} className="text-white" />
                </div>
                <h1 className="text-2xl font-semibold text-[#e9edef]">WA Summariser</h1>
                <p className="text-[#8696a0] text-sm text-center max-w-xs">
                    Scan the QR code with WhatsApp to link your device
                </p>
            </div>

            {/* QR Box */}
            <div className="bg-white p-5 rounded-2xl shadow-2xl qr-fade w-90 max-w-full flex flex-col items-center gap-3">
                {qr ? (
                    <QRCodeCanvas
                        value={qr}
                        size={300}
                        level="L"
                        includeMargin
                        className="w-75 h-75 [image-rendering:pixelated]"
                    />
                ) : (
                    <div className="w-75 h-75 flex flex-col items-center justify-center gap-3 text-gray-400">
                        <Wifi size={40} className="animate-pulse text-[#00a884]" />
                        <span className="text-sm text-gray-500">
                            {status === 'loading' ? 'Connecting...' : 'Waiting for QR...'}
                        </span>
                    </div>
                )}
            </div>

            {/* Instructions */}
            <div className="flex flex-col gap-2 text-sm text-[#8696a0] text-center">
                <p>1. Open WhatsApp on your phone</p>
                <p>2. Go to <strong className="text-[#e9edef]">Settings → Linked Devices</strong></p>
                <p>3. Tap <strong className="text-[#e9edef]">Link a Device</strong> and scan</p>
            </div>
        </div>
    );
}
