export const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

function getSessionId() {
    return localStorage.getItem('wa_session_id') || '';
}

async function parseResponse(response) {
    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { error: text };
        }
    }

    if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`);
    }

    return data;
}

export const api = {
    get: (path) => fetch(`${BACKEND}${path}`, {
        headers: { 'X-Session-Id': getSessionId() },
    }).then(parseResponse),
    post: (path, body) => fetch(`${BACKEND}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': getSessionId(),
        },
        body: JSON.stringify(body),
    }).then(parseResponse),
};
