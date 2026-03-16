import { useState } from 'react';
import { Search, Settings, MessageCircle } from 'lucide-react';

function getInitials(name = '') {
    return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}

const COLORS = ['#00a884', '#128c7e', '#25d366', '#075e54', '#34b7f1', '#5b5ea6'];
function colorFor(name = '') {
    let h = 0;
    for (let c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
    return COLORS[h];
}

export default function Sidebar({ chats, selectedId, onSelect, onSettings }) {
    const [search, setSearch] = useState('');

    const filtered = chats.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full w-[340px] min-w-[260px] bg-[#111b21] border-r border-[#222d34]">
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between bg-[#202c33]">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center">
                        <MessageCircle size={20} className="text-white" />
                    </div>
                    <span className="font-semibold text-[#e9edef] text-base">WA Summariser</span>
                </div>
                <button
                    onClick={onSettings}
                    className="p-2 rounded-full hover:bg-[#2a3942] transition-colors text-[#8696a0] hover:text-[#e9edef]"
                    title="Settings"
                >
                    <Settings size={20} />
                </button>
            </div>

            {/* Search */}
            <div className="px-3 py-2 bg-[#111b21]">
                <div className="flex items-center bg-[#202c33] rounded-lg px-3 py-2 gap-2">
                    <Search size={16} className="text-[#8696a0]" />
                    <input
                        type="text"
                        placeholder="Search chats"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="bg-transparent text-[#e9edef] text-sm flex-1 outline-none placeholder-[#8696a0]"
                    />
                </div>
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto">
                {filtered.length === 0 && (
                    <div className="text-center text-[#8696a0] text-sm py-10">No chats found</div>
                )}
                {filtered.map(chat => (
                    <button
                        key={chat.id}
                        onClick={() => onSelect(chat)}
                        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#202c33] transition-colors border-b border-[#222d34]/40 text-left
                            ${selectedId === chat.id ? 'bg-[#2a3942]' : ''}`}
                    >
                        {/* Avatar */}
                        <div
                            className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm"
                            style={{ backgroundColor: colorFor(chat.name) }}
                        >
                            {getInitials(chat.name)}
                        </div>
                        {/* Text */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <span className="text-[#e9edef] text-sm font-medium truncate">{chat.name}</span>
                                {chat.unreadCount > 0 && (
                                    <span className="ml-2 bg-[#00a884] text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                                        {chat.unreadCount}
                                    </span>
                                )}
                            </div>
                            <p className="text-[#8696a0] text-xs truncate mt-0.5">{chat.lastMessage || '—'}</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
