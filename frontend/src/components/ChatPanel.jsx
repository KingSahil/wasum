import { useState } from 'react';
import { Sparkles, Loader2, Users, User } from 'lucide-react';
import { api } from '../api';
import LogTerminal from './LogTerminal';
import SummaryCard from './SummaryCard';

function getInitials(name = '') {
    return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}

export default function ChatPanel({ chat, logs, summary, setSummary }) {
    const [limit, setLimit] = useState(50);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSummarise = async () => {
        if (!chat) return;
        setLoading(true);
        setError(null);
        setSummary(null);
        try {
            const res = await api.post('/api/summarise', { chatId: chat.id, limit });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            setSummary(data.summary);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!chat) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0b141a] gap-4 text-[#8696a0]">
                <div className="w-24 h-24 rounded-full bg-[#202c33] flex items-center justify-center">
                    <Sparkles size={36} className="text-[#00a884]" />
                </div>
                <p className="text-lg font-medium text-[#e9edef]">WA Summariser</p>
                <p className="text-sm">Select a chat to get started</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-[#0b141a] overflow-hidden">
            {/* Chat header */}
            <div className="flex items-center gap-3 px-5 py-3 bg-[#202c33] border-b border-[#222d34] shadow-sm">
                <div className="w-10 h-10 rounded-full bg-[#075e54] flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                    {getInitials(chat.name)}
                </div>
                <div className="flex-1">
                    <p className="text-[#e9edef] font-medium text-sm">{chat.name}</p>
                    <p className="text-[#8696a0] text-xs flex items-center gap-1">
                        {chat.isGroup ? <Users size={11} /> : <User size={11} />}
                        {chat.isGroup ? 'Group chat' : 'Direct message'}
                    </p>
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col gap-4 p-5 overflow-y-auto">
                {/* Controls */}
                <div className="bg-[#202c33] rounded-2xl p-5 flex flex-col gap-4 border border-[#222d34]">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-[#8696a0] font-medium uppercase tracking-wide">
                                Messages to fetch
                            </label>
                            <span className="text-[#00a884] font-semibold text-sm bg-[#0b141a] px-2 py-0.5 rounded-lg">
                                {limit}
                            </span>
                        </div>
                        <input
                            type="range"
                            min={10}
                            max={200}
                            step={10}
                            value={limit}
                            onChange={e => setLimit(Number(e.target.value))}
                            className="w-full accent-[#00a884] cursor-pointer"
                        />
                        <div className="flex justify-between text-[#8696a0] text-xs">
                            <span>10</span><span>100</span><span>200</span>
                        </div>
                    </div>

                    <button
                        onClick={handleSummarise}
                        disabled={loading}
                        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#00a884] hover:bg-[#00c49a] active:scale-[0.98] text-white font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-[#00a884]/20"
                    >
                        {loading
                            ? <><Loader2 size={16} className="animate-spin" /> Summarising...</>
                            : <><Sparkles size={16} /> Summarise {limit} messages</>
                        }
                    </button>

                    {error && (
                        <p className="text-[#f15c6d] text-xs text-center bg-[#f15c6d]/10 rounded-lg px-3 py-2">{error}</p>
                    )}
                </div>

                {/* Summary card */}
                {summary && <SummaryCard summary={summary} onDismiss={() => setSummary(null)} />}

                {/* Log terminal */}
                <div className="flex-1 min-h-[120px]">
                    <LogTerminal logs={logs} />
                </div>
            </div>
        </div>
    );
}
