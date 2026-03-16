import { useState, useEffect } from 'react';
import { X, Save, Eye, EyeOff } from 'lucide-react';
import { api } from '../api';

const FIELDS = [
    { key: 'GROQ_API_KEY', label: 'Groq API Key', type: 'text', sensitive: true },
    { key: 'GROQ_MODEL', label: 'Groq Model', type: 'text', placeholder: 'e.g. deepseek-r1-distill-llama-70b' },
    { key: 'NTFY_TOPIC', label: 'ntfy Topic URL', type: 'text', placeholder: 'https://ntfy.sh/your-topic' },
    { key: 'NTFY_TITLE', label: 'Notification Title', type: 'text' },
    { key: 'NTFY_PRIORITY', label: 'Priority', type: 'select', options: ['min', 'low', 'default', 'high', 'urgent'] },
    { key: 'DEFAULT_MESSAGE_LIMIT', label: 'Default Message Limit', type: 'number' },
];

export default function SettingsModal({ onClose, onShowTutorial }) {
    const [values, setValues] = useState({});
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    useEffect(() => {
        api.get('/api/settings').then(d => setValues(d));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        await api.post('/api/settings', values);
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleLogoutWhatsApp = async () => {
        const confirmed = window.confirm('Logout this connected WhatsApp session? You will need to scan QR again.');
        if (!confirmed) return;

        try {
            setLoggingOut(true);
            await api.post('/api/logout', {});
            onClose();
        } finally {
            setLoggingOut(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#202c33] rounded-2xl w-full max-w-md shadow-2xl border border-[#2a3942]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a3942]">
                    <h2 className="text-[#e9edef] font-semibold text-base">Settings</h2>
                    <button onClick={onClose} className="text-[#8696a0] hover:text-[#e9edef] p-1 rounded-full hover:bg-[#2a3942]">
                        <X size={18} />
                    </button>
                </div>

                {/* Fields */}
                <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    {FIELDS.map(f => (
                        <div key={f.key} className="flex flex-col gap-1.5">
                            <label className="text-xs text-[#8696a0] font-medium">{f.label}</label>
                            {f.type === 'select' ? (
                                <select
                                    value={values[f.key] || ''}
                                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                                    className="bg-[#2a3942] text-[#e9edef] text-sm rounded-lg px-3 py-2 outline-none border border-transparent focus:border-[#00a884]"
                                >
                                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            ) : (
                                <div className="relative">
                                    <input
                                        type={f.type}
                                        name={f.key === 'GROQ_API_KEY' ? 'groq-api-key' : f.key.toLowerCase()}
                                        value={values[f.key] || ''}
                                        onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                                        placeholder={f.placeholder || ''}
                                        autoComplete={f.key === 'GROQ_API_KEY' ? 'off' : undefined}
                                        autoCorrect={f.key === 'GROQ_API_KEY' ? 'off' : undefined}
                                        autoCapitalize={f.key === 'GROQ_API_KEY' ? 'none' : undefined}
                                        spellCheck={f.key === 'GROQ_API_KEY' ? false : undefined}
                                        data-lpignore={f.key === 'GROQ_API_KEY' ? 'true' : undefined}
                                        data-1p-ignore={f.key === 'GROQ_API_KEY' ? 'true' : undefined}
                                        style={f.sensitive && !showKey ? { WebkitTextSecurity: 'disc' } : undefined}
                                        className="w-full bg-[#2a3942] text-[#e9edef] text-sm rounded-lg px-3 py-2 outline-none border border-transparent focus:border-[#00a884] pr-8"
                                    />
                                    {f.sensitive && (
                                        <button
                                            type="button"
                                            onClick={() => setShowKey(s => !s)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#e9edef]"
                                        >
                                            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[#2a3942] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleLogoutWhatsApp}
                            disabled={loggingOut || saving}
                            className="px-4 py-2 text-sm text-red-300 hover:text-red-200 rounded-lg hover:bg-red-500/10 disabled:opacity-50"
                        >
                            {loggingOut ? 'Logging out...' : 'Logout WhatsApp'}
                        </button>
                        <button
                            onClick={onShowTutorial}
                            disabled={saving || loggingOut}
                            className="px-4 py-2 text-sm text-[#8696a0] hover:text-[#e9edef] rounded-lg hover:bg-[#2a3942] disabled:opacity-50"
                        >
                            Show Tutorial
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-[#8696a0] hover:text-[#e9edef] rounded-lg hover:bg-[#2a3942]">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2 bg-[#00a884] hover:bg-[#00c49a] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
                        >
                            <Save size={14} />
                            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
