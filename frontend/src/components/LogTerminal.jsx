import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

const levelColor = {
    info: 'text-[#8696a0]',
    success: 'text-[#00a884]',
    error: 'text-[#f15c6d]',
};

export default function LogTerminal({ logs }) {
    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="flex flex-col h-full bg-[#0b141a] rounded-xl overflow-hidden border border-[#222d34]">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#202c33] border-b border-[#222d34]">
                <Terminal size={14} className="text-[#00a884]" />
                <span className="text-xs text-[#8696a0] font-mono">live log</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
                {logs.length === 0 && (
                    <span className="text-[#374045]">Waiting for activity...</span>
                )}
                {logs.map((log, i) => (
                    <div key={i} className={`${levelColor[log.level] || 'text-[#8696a0]'} leading-5`}>
                        <span className="text-[#374045] select-none mr-2">›</span>{log.message}
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
