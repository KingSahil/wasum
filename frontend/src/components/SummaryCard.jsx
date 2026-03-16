import { useState } from 'react';
import { Copy, CheckCheck, Bell } from 'lucide-react';

export default function SummaryCard({ summary, onDismiss }) {
    const [copied, setCopied] = useState(false);

    if (!summary) return null;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(summary);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bubble-in">
            <div className="flex items-center gap-2 mb-2">
                <Bell size={14} className="text-[#00a884]" />
                <span className="text-xs text-[#8696a0] font-medium uppercase tracking-wide">Summary</span>
                <button
                    onClick={onDismiss}
                    className="ml-auto text-[#8696a0] hover:text-[#e9edef] text-xs"
                >
                    dismiss
                </button>
            </div>
            {/* WhatsApp received bubble */}
            <div className="relative bg-[#202c33] rounded-xl rounded-tl-none px-4 py-3 text-[#e9edef] text-sm leading-relaxed shadow-lg max-h-64 overflow-y-auto">
                <div className="absolute -top-0 -left-1.5 w-3 h-3 bg-[#202c33] clip-bubble" />
                <p>{summary}</p>
                <div className="flex items-center justify-end gap-1 mt-2">
                    <span className="text-[#8696a0] text-xs">
                        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <CheckCheck size={14} className="text-[#53bdeb]" />
                </div>
            </div>
            <button
                onClick={handleCopy}
                className="mt-2 flex items-center gap-1.5 text-xs text-[#8696a0] hover:text-[#00a884] transition-colors"
            >
                {copied ? <CheckCheck size={13} className="text-[#00a884]" /> : <Copy size={13} />}
                {copied ? 'Copied!' : 'Copy summary'}
            </button>
        </div>
    );
}
