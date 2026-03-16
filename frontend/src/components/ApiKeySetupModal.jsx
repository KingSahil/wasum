import { useState } from 'react';
import { KeyRound, Bell, Eye, EyeOff, Save, ArrowRight } from 'lucide-react';
import { api } from '../api';

export default function ApiKeySetupModal({ hasApiKey, hasNtfyTopic, onSaved }) {
    const [step, setStep] = useState(() => {
        if (!hasApiKey) return 1;
        if (!hasNtfyTopic) return 2;
        return 1;
    });

    // Step 1 – Groq API key
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);

    // Step 2 – ntfy topic URL
    const [ntfyTopic, setNtfyTopic] = useState('');

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSaveApiKey = async () => {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            setError('API key is required to continue.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const data = await api.post('/api/settings', { GROQ_API_KEY: trimmed });
            if (data?.error) throw new Error(data.error || 'Failed to save API key');
            setStep(2);
        } catch (err) {
            setError(err.message || 'Failed to save API key');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveNtfy = async (skip = false) => {
        const trimmed = ntfyTopic.trim();
        if (!skip && !trimmed) {
            setError('Enter a topic URL or skip.');
            return;
        }
        if (!skip) {
            setSaving(true);
            setError('');
            try {
                const data = await api.post('/api/settings', { NTFY_TOPIC: trimmed });
                if (data?.error) throw new Error(data.error || 'Failed to save ntfy topic');
            } catch (err) {
                setError(err.message || 'Failed to save ntfy topic');
                setSaving(false);
                return;
            }
            setSaving(false);
        }
        await onSaved();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl">

                {/* Header */}
                <div className="px-5 py-4 border-b border-[#2a3942] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {step === 1 ? <KeyRound size={16} className="text-[#00a884]" /> : <Bell size={16} className="text-[#00a884]" />}
                        <h2 className="text-[#e9edef] font-semibold text-base">
                            {step === 1 ? 'Groq API key' : 'Notification topic'}
                        </h2>
                    </div>
                    <span className="text-xs text-[#8696a0]">Step {step} of 2</span>
                </div>

                {/* Body */}
                <div className="px-5 py-5 space-y-3">
                    {step === 1 ? (
                        <>
                            <p className="text-sm text-[#8696a0]">
                                WhatsApp is linked. Enter your Groq API key to enable chat summaries.
                            </p>
                            <div className="relative">
                                <input
                                    type="text"
                                    name="groq-api-key"
                                    value={apiKey}
                                    onChange={e => { setApiKey(e.target.value); setError(''); }}
                                    placeholder="gsk_..."
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    data-lpignore="true"
                                    data-1p-ignore="true"
                                    style={!showKey ? { WebkitTextSecurity: 'disc' } : undefined}
                                    className="w-full bg-[#2a3942] text-[#e9edef] text-sm rounded-lg px-3 py-2 outline-none border border-transparent focus:border-[#00a884] pr-9"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowKey(v => !v)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#e9edef]"
                                >
                                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-[#8696a0]">
                                Enter an <span className="text-[#e9edef] font-medium">ntfy</span> topic URL to receive push notifications when summaries are ready. You can skip this and add it later.
                            </p>
                            <input
                                type="text"
                                name="ntfy-topic"
                                value={ntfyTopic}
                                onChange={e => { setNtfyTopic(e.target.value); setError(''); }}
                                placeholder="https://ntfy.sh/your-topic"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className="w-full bg-[#2a3942] text-[#e9edef] text-sm rounded-lg px-3 py-2 outline-none border border-transparent focus:border-[#00a884]"
                            />
                        </>
                    )}

                    {error && (
                        <p className="text-[#f15c6d] text-xs bg-[#f15c6d]/10 rounded-lg px-3 py-2">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[#2a3942] flex justify-end gap-3">
                    {step === 1 ? (
                        <button
                            onClick={handleSaveApiKey}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2 bg-[#00a884] hover:bg-[#00c49a] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
                        >
                            <ArrowRight size={14} />
                            {saving ? 'Saving...' : 'Next'}
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={() => handleSaveNtfy(true)}
                                disabled={saving}
                                className="px-4 py-2 text-sm text-[#8696a0] hover:text-[#e9edef] rounded-lg hover:bg-[#2a3942] disabled:opacity-50"
                            >
                                Skip
                            </button>
                            <button
                                onClick={() => handleSaveNtfy(false)}
                                disabled={saving}
                                className="flex items-center gap-2 px-5 py-2 bg-[#00a884] hover:bg-[#00c49a] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                <Save size={14} />
                                {saving ? 'Saving...' : 'Save & Finish'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
