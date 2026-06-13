// ===== Floating Bubbles Background =====
(function createBubbles() {
    const container = document.getElementById('stars');
    const colors = ['#06b6d4', '#38bdf8', '#a78bfa', '#f472b6', '#67e8f9', '#34d399', '#fbbf24', '#fb7185', '#818cf8'];
    for (let i = 0; i < 35; i++) {
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        const size = Math.random() * 100 + 15;
        const color = colors[Math.floor(Math.random() * colors.length)];
        bubble.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${Math.random() * 100}%;
            --bubble-color: ${color};
            --dur: ${Math.random() * 18 + 12}s;
            --delay: ${Math.random() * 20}s;
            --drift: ${(Math.random() * 140 - 70)}px;
        `;
        container.appendChild(bubble);
    }
})();

// ===== Navigation =====
const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = link.dataset.page;
        navLinks.forEach(l => l.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        link.classList.add('active');
        document.getElementById('page-' + pageId).classList.add('active');
        if (pageId !== 'home') checkDocUploaded();
    });
});

// ===== State =====
let uploadedFilename = null;
let chatHistory = [];   // [{role:'user',text:''},{role:'ai',text:''}]
let voiceHistory = [];
let currentSummary = '';
let currentSummaryLevel = 'concise';
let recognition = null;
let isRecording = false;

// ===== File Upload =====
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
        showFileName(file.name);
    }
});

function showFileName(name) {
    const nameEl = document.getElementById('fileName');
    document.getElementById('fileNameText').textContent = name;
    nameEl.style.display = 'flex';
}

function removeFile() {
    fileInput.value = '';
    uploadedFilename = null;
    document.getElementById('fileName').style.display = 'none';
    document.getElementById('chatDocLabel').textContent = 'No document uploaded';
}

// Drag and drop on upload area
const uploadArea = document.getElementById('uploadArea');
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.background = 'rgba(56,189,248,0.1)';
});
uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.background = '';
});
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.pdf')) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        showFileName(file.name);
    }
});

async function uploadFile() {
    const file = fileInput.files[0];
    if (!file) {
        showStatus('Please select a PDF file first.', 'error');
        return;
    }

    const btn = document.getElementById('uploadBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Uploading...';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            uploadedFilename = data.filename;
            showStatus(`✓ "${data.filename}" uploaded successfully!`, 'success');
            updateDocLabels(data.filename);
            // Auto-load standard summary
            fetchSummary('concise');
        } else {
            showStatus(data.error || 'Upload failed.', 'error');
        }
    } catch (err) {
        showStatus('Network error. Please try again.', 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Upload';
}

function showStatus(msg, type) {
    const el = document.getElementById('uploadStatus');
    el.textContent = msg;
    el.className = 'status-msg ' + type;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function updateDocLabels(filename) {
    document.getElementById('chatDocLabel').textContent = filename;
}

async function checkDocUploaded() {
    try {
        const res = await fetch('/doc-info');
        const data = await res.json();
        if (data.uploaded) {
            uploadedFilename = data.filename;
            updateDocLabels(data.filename);
        }
    } catch (e) {}
}

// Init check
checkDocUploaded();

// ===== Clear input helper =====
function clearInput(id) {
    const el = document.getElementById(id);
    el.value = '';
    el.focus();
}

// ===== Typewriter text animation =====
function typewriterEffect(el, text, speed = 18) {
    return new Promise((resolve) => {
        const formatted = escapeHtml(text);
        let i = 0;
        const cursor = document.createElement('span');
        cursor.className = 'stream-cursor';

        el.innerHTML = '';
        el.appendChild(cursor);

        // Use a temporary container to type character by character
        // while keeping <br> tags intact
        const tokens = tokenizeHtml(formatted);

        function step() {
            if (i < tokens.length) {
                cursor.insertAdjacentHTML('beforebegin', tokens[i]);
                i++;
                const container = el.closest('.chat-messages, .voice-messages');
                if (container) container.scrollTop = container.scrollHeight;
                setTimeout(step, speed);
            } else {
                cursor.remove();
                resolve();
            }
        }
        step();
    });
}

// Splits HTML string into tokens, keeping tags like <br> as single units
function tokenizeHtml(html) {
    const tokens = [];
    let i = 0;
    while (i < html.length) {
        if (html[i] === '<') {
            const close = html.indexOf('>', i);
            tokens.push(html.slice(i, close + 1));
            i = close + 1;
        } else {
            tokens.push(html[i]);
            i++;
        }
    }
    return tokens;
}

// ===== Chat =====
async function sendChat() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;

    if (!uploadedFilename) {
        appendChatMsg('ai', 'Please upload a PDF document first from the Home tab.');
        return;
    }

    input.value = '';
    appendChatMsg('user', question);
    chatHistory.push({ role: 'user', text: question });

    const loadingId = appendChatLoading();

    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await res.json();
        removeChatLoading(loadingId);

        if (data.answer) {
            await appendChatMsgAnimated('ai', data.answer);
            chatHistory.push({ role: 'ai', text: data.answer });
        } else {
            await appendChatMsgAnimated('ai', data.error || 'Something went wrong.');
        }
    } catch (err) {
        removeChatLoading(loadingId);
        await appendChatMsgAnimated('ai', 'Network error. Please try again.');
    }
}

function appendChatMsg(role, text) {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = role === 'user' ? 'msg-user' : 'msg-ai';
    div.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Appends an AI message with a typewriter animation
async function appendChatMsgAnimated(role, text) {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = role === 'user' ? 'msg-user' : 'msg-ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    div.appendChild(bubble);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    if (role === 'ai') {
        await typewriterEffect(bubble, text);
    } else {
        bubble.innerHTML = escapeHtml(text);
    }
}

function appendChatLoading() {
    const container = document.getElementById('chatMessages');
    const id = 'loading-' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg-ai msg-loading';
    div.id = id;
    div.innerHTML = `<div class="bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeChatLoading(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

async function downloadChat() {
    if (chatHistory.length === 0) {
        alert('No chat messages to download yet.');
        return;
    }
    const res = await fetch('/download-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory })
    });
    if (res.ok) {
        const blob = await res.blob();
        downloadBlob(blob, 'documind_chat.pdf');
    }
}

// ===== Summary =====
function selectTab(btn, level) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSummaryLevel = level;
    fetchSummary(level);
}

async function fetchSummary(level) {
    const box = document.getElementById('summaryBox');
    box.innerHTML = '<div class="empty-state"><span class="spinner"></span> Generating summary...</div>';

    try {
        const res = await fetch('/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level })
        });
        const data = await res.json();

        if (data.summary) {
            currentSummary = data.summary;
            box.innerHTML = '';
            await typewriterEffect(box, data.summary, 12);
        } else {
            box.innerHTML = `<div class="empty-state" style="color:#fca5a5;">${data.error || 'Failed to generate summary.'}</div>`;
        }
    } catch (err) {
        box.innerHTML = '<div class="empty-state" style="color:#fca5a5;">Network error. Please try again.</div>';
    }
}

async function downloadSummary() {
    if (!currentSummary) {
        alert('No summary to download yet. Please generate a summary first.');
        return;
    }
    const res = await fetch('/download-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: currentSummary, level: currentSummaryLevel })
    });
    if (res.ok) {
        const blob = await res.blob();
        downloadBlob(blob, 'documind_summary.pdf');
    }
}

// ===== Voice =====
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(r => r[0].transcript)
            .join('');
        document.getElementById('voiceTranscript').value = transcript;
        if (event.results[event.results.length - 1].isFinal) {
            sendVoice();
        }
    };

    rec.onerror = (event) => {
        console.error('Speech error:', event.error);
        stopRecording();
    };

    rec.onend = () => { stopRecording(); };

    return rec;
}

function toggleVoice() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    if (!recognition) {
        recognition = setupSpeechRecognition();
    }
    if (!recognition) {
        alert('Speech recognition is not supported in your browser. Please use Chrome or Edge.');
        return;
    }
    try {
        recognition.start();
        isRecording = true;
        document.getElementById('micBtn').classList.add('recording');
    } catch (e) {
        console.error(e);
    }
}

function stopRecording() {
    isRecording = false;
    document.getElementById('micBtn').classList.remove('recording');
    if (recognition) {
        try { recognition.stop(); } catch (e) {}
    }
}

async function sendVoice() {
    const input = document.getElementById('voiceTranscript');
    const question = input.value.trim();
    if (!question) return;

    if (!uploadedFilename) {
        await appendVoiceMsgAnimated('ai', 'Please upload a PDF document first from the Home tab.');
        return;
    }

    input.value = '';
    appendVoiceMsg('user', question);
    voiceHistory.push({ role: 'user', text: question });

    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await res.json();

        if (data.answer) {
            await appendVoiceMsgAnimated('ai', data.answer);
            voiceHistory.push({ role: 'ai', text: data.answer });
            // Text-to-speech
            if (window.speechSynthesis) {
                const utter = new SpeechSynthesisUtterance(data.answer);
                utter.rate = 0.95;
                window.speechSynthesis.speak(utter);
            }
        } else {
            await appendVoiceMsgAnimated('ai', data.error || 'Something went wrong.');
        }
    } catch (err) {
        await appendVoiceMsgAnimated('ai', 'Network error. Please try again.');
    }
}

function appendVoiceMsg(role, text) {
    const container = document.getElementById('voiceMessages');
    const div = document.createElement('div');
    if (role === 'user') {
        div.className = 'voice-msg-user';
        div.innerHTML = `<span>${escapeHtml(text)}</span>`;
    } else {
        div.className = 'voice-msg-ai';
        div.innerHTML = `<div>${escapeHtml(text)}</div>`;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Appends an AI voice message with typewriter animation
async function appendVoiceMsgAnimated(role, text) {
    const container = document.getElementById('voiceMessages');
    const div = document.createElement('div');

    if (role === 'user') {
        div.className = 'voice-msg-user';
        div.innerHTML = `<span>${escapeHtml(text)}</span>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return;
    }

    div.className = 'voice-msg-ai';
    const inner = document.createElement('div');
    div.appendChild(inner);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    await typewriterEffect(inner, text, 18);
}

function clearVoiceChat() {
    voiceHistory = [];
    document.getElementById('voiceMessages').innerHTML = '';
    document.getElementById('voiceTranscript').value = '';
}

async function downloadVoice() {
    if (voiceHistory.length === 0) {
        alert('No voice chat messages to download yet.');
        return;
    }
    const res = await fetch('/download-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: voiceHistory })
    });
    if (res.ok) {
        const blob = await res.blob();
        downloadBlob(blob, 'documind_voice.pdf');
    }
}

// ===== Utilities =====
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Also allow Enter on voice transcript
document.getElementById('voiceTranscript').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendVoice();
});