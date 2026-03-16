export const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

function getSessionId() {
    return localStorage.getItem('wa_session_id') || '';
}

export const api = {
    get: (path) => fetch(`${BACKEND}${path}`, {
        headers: { 'X-Session-Id': getSessionId() },
    }).then(r => r.json()),
    post: (path, body) => fetch(`${BACKEND}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': getSessionId(),
        },
        body: JSON.stringify(body),
    }).then(r => r.json()),
};
