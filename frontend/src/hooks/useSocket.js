import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// In dev: proxy handles routing to localhost:3000
// In production: set VITE_BACKEND_URL to your backend base URL (for example Cloudflare tunnel URL)
const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

export function useSocket(sessionId) {
    const [status, setStatus] = useState('loading');
    const [qr, setQr] = useState(null);
    const [logs, setLogs] = useState([]);
    const [summary, setSummary] = useState(null);

    useEffect(() => {
        if (!sessionId) return;
        const socket = io(BACKEND, { path: '/socket.io', auth: { sessionId } });

        socket.on('status', s => setStatus(s));
        socket.on('qr', q => { setQr(q); setStatus('qr'); });
        socket.on('ready', () => { setStatus('connected'); setQr(null); });
        socket.on('log', entry => setLogs(prev => [...prev.slice(-199), entry]));
        socket.on('summary_done', s => setSummary(s));

        return () => socket.disconnect();
    }, [sessionId]);

    return { status, qr, logs, summary, setSummary };
}
