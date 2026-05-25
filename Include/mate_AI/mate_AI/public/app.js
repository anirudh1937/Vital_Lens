/* ============================================
   MATE AI — Frontend Application Logic
   ============================================ */

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const micBtn = document.getElementById('micBtn');
const clearBtn = document.getElementById('clearBtn');
const refreshBtn = document.getElementById('refreshBtn');
const stackBtn = document.getElementById('stackBtn');
const stackModal = document.getElementById('stackModal');
const stackCloseBtn = document.getElementById('stackCloseBtn');
const stackContent = document.getElementById('stackContent');
const profileBtn = document.getElementById('profileBtn') || document.getElementById('contactsBtn');
const profileModal = document.getElementById('profileModal') || document.getElementById('contactsModal');
const profileCloseBtn = document.getElementById('profileCloseBtn') || document.getElementById('contactsCloseBtn');
const profileConnectBtn = document.getElementById('profileConnectBtn') || document.getElementById('contactsConnectBtn');
const profileSyncBtn = document.getElementById('profileSyncBtn') || document.getElementById('contactsSyncBtn');
const profileDisconnectBtn = document.getElementById('profileDisconnectBtn') || document.getElementById('contactsDisconnectBtn');
const profileStatus = document.getElementById('profileStatus') || document.getElementById('contactsStatus');
const profileImage = document.getElementById('profileImage');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const profilePhotoInput = document.getElementById('profilePhotoInput');
const medicalBtn = document.getElementById('medicalBtn');
const medicalModal = document.getElementById('medicalModal');
const medicalCloseBtn = document.getElementById('medicalCloseBtn');
const medicalForm = document.getElementById('medicalForm');
const medicalAnalyzeBtn = document.getElementById('medicalAnalyzeBtn');
const medicalResetBtn = document.getElementById('medicalResetBtn');
const medicalStatus = document.getElementById('medicalStatus');
const medicalResult = document.getElementById('medicalResult');
const newChatBtn = document.getElementById('newChatBtn');
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const welcomeScreen = document.getElementById('welcomeScreen');
const attachmentsPreview = document.getElementById('attachmentsPreview');

// State
let isGenerating = false;
let attachments = [];
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let speechRecognition = null;
let isVoiceListening = false;
let currentChatId = null;
let allChats = [];
let ragSourcesForResponse = '';
let webSourcesForResponse = '';
let responseModeForResponse = 'default';
let googleProfileState = null;
const FEEDBACK_LABEL = { up: 'Helpful', down: 'Needs work' };
const chatHistoryList = document.getElementById('chatHistoryList');
const historySearchInput = document.getElementById('historySearchInput');
const historyCountBadge = document.getElementById('historyCountBadge');

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
    messageInput.focus();
    setupEventListeners();
    setupDragAndDrop();
    autoResizeTextarea();
    loadChatHistory();
});

function setupEventListeners() {
    // Send message
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', autoResizeTextarea);

    // File upload
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Voice command / audio recording fallback
    micBtn.addEventListener('click', toggleRecording);

    // Clear chat
    clearBtn.addEventListener('click', clearChat);
    newChatBtn.addEventListener('click', clearChat);
    if (refreshBtn) refreshBtn.addEventListener('click', refreshApp);
    if (stackBtn) stackBtn.addEventListener('click', openStackModal);
    if (stackCloseBtn) stackCloseBtn.addEventListener('click', closeStackModal);
    if (profileBtn) profileBtn.addEventListener('click', openProfileModal);
    if (profileCloseBtn) profileCloseBtn.addEventListener('click', closeProfileModal);
    if (profileConnectBtn) profileConnectBtn.addEventListener('click', connectGoogleProfile);
    if (profileSyncBtn) profileSyncBtn.addEventListener('click', syncGoogleProfile);
    if (profileDisconnectBtn) profileDisconnectBtn.addEventListener('click', disconnectGoogleProfile);
    if (medicalBtn) medicalBtn.addEventListener('click', openMedicalModal);
    if (medicalCloseBtn) medicalCloseBtn.addEventListener('click', closeMedicalModal);
    if (medicalForm) medicalForm.addEventListener('submit', submitMedicalAnalysis);
    if (medicalResetBtn) medicalResetBtn.addEventListener('click', resetMedicalForm);
    if (profilePhotoInput) {
        profilePhotoInput.addEventListener('change', uploadProfilePhoto);
    }
    if (stackModal) {
        stackModal.addEventListener('click', (e) => {
            if (e.target === stackModal) closeStackModal();
        });
    }
    if (profileModal) {
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) closeProfileModal();
        });
    }
    if (medicalModal) {
        medicalModal.addEventListener('click', (e) => {
            if (e.target === medicalModal) closeMedicalModal();
        });
    }

    // Mobile sidebar toggle
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

    // History search
    historySearchInput.addEventListener('input', handleHistorySearch);
    messagesEl.addEventListener('click', handleFeedbackClick);

    // Quick prompts
    document.querySelectorAll('.quick-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            messageInput.value = btn.dataset.prompt;
            autoResizeTextarea();
            sendMessage();
        });
    });

    initVoiceRecognition();
}

function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
}

// ========== CHAT MESSAGING ==========

async function sendMessage() {
    const message = messageInput.value.trim();
    if ((!message && attachments.length === 0) || isGenerating) return;

    if (attachments.length === 0) {
        const parsedMlCmd = parseMlCommand(message);
        if (parsedMlCmd) {
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            addMessage('user', message, []);
            messageInput.value = '';
            autoResizeTextarea();
            await runMlCommand(parsedMlCmd);
            return;
        }

        const parsedModelCmd = parseModelCommand(message);
        if (parsedModelCmd) {
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            addMessage('user', message, []);
            messageInput.value = '';
            autoResizeTextarea();
            await runModelCommand(parsedModelCmd);
            return;
        }

        const parsedCmd = parseEmailCommand(message);
        if (parsedCmd) {
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            addMessage('user', message, []);
            messageInput.value = '';
            autoResizeTextarea();
            await sendAdminEmail(parsedCmd.to, parsedCmd.subject, parsedCmd.body);
            return;
        }
    }

    // Hide welcome screen
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // Create user message
    const userAttachments = [...attachments];
    addMessage('user', message, userAttachments);

    // Clear input
    messageInput.value = '';
    autoResizeTextarea();
    clearAttachments();

    // Show typing indicator
    const typingEl = addTypingIndicator();

    isGenerating = true;
    sendBtn.disabled = true;

    try {
        let response;
        const payload = {
            message,
            chatId: currentChatId,
            attachments: userAttachments.map(a => ({
                name: a.name,
                type: a.type,
                path: a.serverPath || ''
            }))
        };
        try {
            response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (firstErr) {
            // One retry helps when dev server reloads or network briefly drops.
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
                response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (secondErr) {
                throw new Error('Cannot reach Mate AI server at http://localhost:3000. Check server is running and refresh the page.');
            }
        }

        const newId = response.headers.get('X-Chat-Id');
        const assistantMessageId = response.headers.get('X-Assistant-Message-Id') || '';
        responseModeForResponse = response.headers.get('X-Response-Mode') || 'default';
        ragSourcesForResponse = response.headers.get('X-Rag-Sources') || '';
        webSourcesForResponse = response.headers.get('X-Web-Sources') || '';
        let wasNewChat = !currentChatId;
        if (newId) currentChatId = newId;

        if (wasNewChat) {
            loadChatHistory();
        }

        // Remove typing indicator
        typingEl.remove();

        if (!response.ok) {
            let messageText = 'Server error';
            try {
                const err = await response.json();
                messageText = err.error || messageText;
            } catch (_) {
                messageText = await response.text() || messageText;
            }
            throw new Error(messageText);
        }

        // Stream the response
        const assistantEl = addMessage('assistant', '', [], { messageId: assistantMessageId, feedback: null });
        const bubbleEl = assistantEl.querySelector('.message-bubble');
        let fullContent = '';

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

            for (const line of lines) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.content) {
                        fullContent += data.content;
                        bubbleEl.innerHTML = renderMarkdown(fullContent);
                        scrollToBottom();
                    }
                } catch (e) {
                    // Skip
                }
            }
        }

        // Final render
        const sourceLines = [];
        if (responseModeForResponse) sourceLines.push(`Mode: ${responseModeForResponse}`);
        if (ragSourcesForResponse) sourceLines.push(`Local KB: ${ragSourcesForResponse}`);
        if (webSourcesForResponse) sourceLines.push(`Web: ${webSourcesForResponse}`);
        if (sourceLines.length > 0) fullContent += `\n\n---\nSources:\n${sourceLines.join('\n')}`;
        bubbleEl.innerHTML = renderMarkdown(fullContent);
        scrollToBottom();

    } catch (error) {
        typingEl?.remove();
        addMessage('assistant', `⚠️ **Error:** ${error.message}`, []);
    } finally {
        isGenerating = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function addMessage(role, content, messageAttachments = [], meta = {}) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;

    const avatar = role === 'user' ? '👤' : '🤖';
    const messageId = meta.messageId || '';
    const feedback = meta.feedback || null;
    const feedbackHtml = role === 'assistant'
        ? `
      <div class="message-feedback ${messageId ? '' : 'disabled'}" data-message-id="${escapeHtml(messageId)}" data-feedback="${feedback?.rating || ''}">
        <button class="feedback-btn ${feedback?.rating === 'up' ? 'active' : ''}" data-rating="up" title="Helpful">👍</button>
        <button class="feedback-btn ${feedback?.rating === 'down' ? 'active' : ''}" data-rating="down" title="Needs work">👎</button>
        <span class="feedback-status">${feedback?.rating ? FEEDBACK_LABEL[feedback.rating] : 'Rate reply'}</span>
      </div>`
        : '';

    let attachmentsHtml = '';
    if (messageAttachments.length > 0) {
        attachmentsHtml = `<div class="message-attachments">
      ${messageAttachments.map(a => `
        <div class="message-attachment">
          <span class="message-attachment-icon">${getFileIcon(a.type)}</span>
          <span>${a.name}</span>
        </div>
      `).join('')}
    </div>`;
    }

    messageEl.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      ${attachmentsHtml}
      <div class="message-bubble">${role === 'assistant' ? renderMarkdown(content) : escapeHtml(content)}</div>
      ${feedbackHtml}
    </div>
  `;

    messagesEl.appendChild(messageEl);
    scrollToBottom();
    return messageEl;
}

async function handleFeedbackClick(e) {
    const btn = e.target.closest('.feedback-btn');
    if (!btn) return;

    const wrap = btn.closest('.message-feedback');
    if (!wrap || wrap.classList.contains('disabled') || wrap.classList.contains('loading')) return;

    const messageId = wrap.dataset.messageId;
    const rating = btn.dataset.rating;
    if (!currentChatId || !messageId || !rating) return;

    wrap.classList.add('loading');
    try {
        const res = await fetch(`/api/chats/${currentChatId}/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId, rating })
        });
        if (!res.ok) {
            throw new Error('Feedback save failed');
        }

        wrap.dataset.feedback = rating;
        wrap.querySelectorAll('.feedback-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.rating === rating);
        });
        const status = wrap.querySelector('.feedback-status');
        if (status) status.textContent = FEEDBACK_LABEL[rating] || 'Saved';
    } catch (err) {
        const status = wrap.querySelector('.feedback-status');
        if (status) status.textContent = 'Save failed';
        console.error(err);
    } finally {
        wrap.classList.remove('loading');
    }
}

function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-bubble typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
}

// ========== CHAT HISTORY DASHBOARD ==========

function timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function loadChatHistory() {
    try {
        const res = await fetch('/api/chats');
        allChats = await res.json();
        renderChatHistory(allChats);
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

function handleHistorySearch() {
    const query = historySearchInput.value.trim().toLowerCase();
    if (!query) {
        renderChatHistory(allChats);
        return;
    }
    const filtered = allChats.filter(c =>
        (c.title && c.title.toLowerCase().includes(query)) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
    );
    renderChatHistory(filtered);
}

function renderChatHistory(chats) {
    if (!chatHistoryList) return;
    chatHistoryList.innerHTML = '';

    // Update count badge
    if (historyCountBadge) {
        historyCountBadge.textContent = allChats.length;
    }

    if (chats.length === 0) {
        chatHistoryList.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">💬</div>
                <span>${historySearchInput.value.trim() ? 'No chats found' : 'No chats yet'}</span>
            </div>
        `;
        return;
    }

    chats.forEach(chat => {
        const el = document.createElement('div');
        el.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
        el.innerHTML = `
            <div class="history-item-main">
                <div class="history-item-title" title="Double-click to rename">${escapeHtml(chat.title)}</div>
                <div class="history-item-meta">
                    <span class="history-item-time">${timeAgo(chat.updatedAt)}</span>
                    ${chat.messageCount ? `<span class="history-msg-badge">${chat.messageCount} msg${chat.messageCount !== 1 ? 's' : ''}</span>` : ''}
                </div>
                ${chat.lastMessage ? `<div class="history-item-preview">${escapeHtml(chat.lastMessage)}</div>` : ''}
            </div>
            <div class="history-item-actions">
                <button class="history-action-btn history-rename-btn" title="Rename" data-id="${chat.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="history-action-btn history-delete-btn" title="Delete" data-id="${chat.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"></polyline><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"></path></svg>
                </button>
            </div>
        `;

        // Click to load
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-action-btn')) return;
            loadChat(chat.id);
        });

        // Rename button
        el.querySelector('.history-rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            renameChat(chat.id, chat.title);
        });

        // Delete button
        el.querySelector('.history-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChat(chat.id);
        });

        // Double-click title to rename
        el.querySelector('.history-item-title').addEventListener('dblclick', (e) => {
            e.stopPropagation();
            renameChat(chat.id, chat.title);
        });

        chatHistoryList.appendChild(el);
    });
}

async function renameChat(id, currentTitle) {
    const newTitle = prompt('Rename chat:', currentTitle);
    if (newTitle && newTitle.trim() && newTitle.trim() !== currentTitle) {
        try {
            await fetch(`/api/chats/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle.trim() })
            });
            loadChatHistory();
        } catch (e) {
            console.error('Rename failed:', e);
        }
    }
}

async function loadChat(id) {
    if (isGenerating) return;
    try {
        const res = await fetch(`/api/chats/${id}`);
        if (!res.ok) throw new Error('Chat not found');
        const chat = await res.json();

        currentChatId = id;
        loadChatHistory(); // update active class

        // Clear existing messages without calling backend clear
        messagesEl.innerHTML = '';
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        // Render stored messages
        chat.messages.forEach(msg => {
            const content = msg.role === 'user' ? (msg.rawText || msg.content) : msg.content;
            addMessage(
                msg.role,
                content,
                msg.role === 'user' ? (msg.attachments || []) : [],
                { messageId: msg.id || '', feedback: msg.feedback || null }
            );
        });

        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('open');
        }
    } catch (e) {
        console.error(e);
    }
}

async function deleteChat(id) {
    if (confirm('Delete this chat?')) {
        await fetch(`/api/chats/${id}`, { method: 'DELETE' });
        if (currentChatId === id) {
            clearChat();
        } else {
            loadChatHistory();
        }
    }
}

// ========== MARKDOWN RENDERING ==========

function renderMarkdown(text) {
    if (!text) return '';

    // Simple markdown renderer (no external dependency needed)
    let html = escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    // Fix nested uls
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Line breaks (double newline = paragraph, single = br)
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraphs if not already
    if (!html.startsWith('<')) {
        html = `<p>${html}</p>`;
    }

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== FILE UPLOAD ==========

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => addAttachment(file));
    fileInput.value = '';
}

async function addAttachment(file) {
    const attachment = {
        file,
        name: file.name,
        type: file.type,
        preview: null,
        serverPath: null
    };

    // Generate preview for images
    if (file.type.startsWith('image/')) {
        attachment.preview = URL.createObjectURL(file);
    }

    // Upload to server
    try {
        const formData = new FormData();
        formData.append('files', file);

        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            if (data.files && data.files[0]) {
                attachment.serverPath = data.files[0].path;
                attachment.ragIndexed = !!data.files[0].ragIndexed;
                attachment.ragChunks = data.files[0].ragChunks || 0;
            }
        }
    } catch (error) {
        console.error('Upload error:', error);
    }

    attachments.push(attachment);
    renderAttachmentsPreview();
}

function renderAttachmentsPreview() {
    if (attachments.length === 0) {
        attachmentsPreview.className = 'attachments-preview';
        attachmentsPreview.innerHTML = '';
        return;
    }

    attachmentsPreview.className = 'attachments-preview has-files';
    attachmentsPreview.innerHTML = attachments.map((a, index) => `
    <div class="attachment-chip">
      ${a.preview ? `<img src="${a.preview}" alt="${a.name}">` : `<span>${getFileIcon(a.type)}</span>`}
      <span>${truncateFilename(a.name, 20)}${a.ragIndexed ? ` · KB ${a.ragChunks}` : ''}</span>
      <button class="attachment-remove" onclick="removeAttachment(${index})">&times;</button>
    </div>
  `).join('');
}

function removeAttachment(index) {
    if (attachments[index]?.preview) {
        URL.revokeObjectURL(attachments[index].preview);
    }
    attachments.splice(index, 1);
    renderAttachmentsPreview();
}

// Make it globally accessible for onclick
window.removeAttachment = removeAttachment;

function clearAttachments() {
    attachments.forEach(a => {
        if (a.preview) URL.revokeObjectURL(a.preview);
    });
    attachments = [];
    renderAttachmentsPreview();
}

// ========== AUDIO RECORDING ==========

async function toggleRecording() {
    if (speechRecognition) {
        if (isVoiceListening) {
            try {
                speechRecognition.stop();
            } catch (e) {
                // ignore stop race
            }
            return;
        }
        try {
            speechRecognition.start();
        } catch (e) {
            console.error('Voice start failed:', e);
            addMessage('assistant', 'Voice command could not start. Please allow microphone access and try again.', []);
        }
        return;
    }

    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function initVoiceRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        micBtn.title = 'Record audio (voice command not supported in this browser)';
        return;
    }

    speechRecognition = new SR();
    speechRecognition.lang = 'en-US';
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;
    speechRecognition.continuous = false;

    speechRecognition.onstart = () => {
        isVoiceListening = true;
        micBtn.classList.add('recording');
        micBtn.title = 'Listening... click again to stop';
    };

    speechRecognition.onend = () => {
        isVoiceListening = false;
        micBtn.classList.remove('recording');
        micBtn.title = 'Voice command';
    };

    speechRecognition.onerror = (e) => {
        const msg = e?.error === 'not-allowed'
            ? 'Microphone permission was denied.'
            : `Voice recognition failed: ${e?.error || 'unknown error'}`;
        addMessage('assistant', `⚠️ ${msg}`, []);
    };

    speechRecognition.onresult = (event) => {
        const transcript = String(event?.results?.[0]?.[0]?.transcript || '').trim();
        if (!transcript) return;
        handleVoiceTranscript(transcript);
    };
}

async function handleVoiceTranscript(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return;

    const parsedCmd = parseEmailCommand(text);
    if (parsedCmd) {
        addMessage('user', `Voice command: send email to ${parsedCmd.to}`, []);
        await sendAdminEmail(parsedCmd.to, parsedCmd.subject, parsedCmd.body);
        return;
    }

    messageInput.value = text;
    autoResizeTextarea();
    await sendMessage();
}

async function sendAdminEmail(to, subject, text) {
    try {
        const res = await fetch('/api/admin/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, text })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Email send failed');
        const accepted = Array.isArray(json.accepted) ? json.accepted.join(', ') : String(to);
        addMessage('assistant', `Email sent successfully.\n\nTo: ${accepted}\nSubject: ${subject}`, []);
    } catch (error) {
        addMessage('assistant', `⚠️ Email command failed: ${error.message}`, []);
    }
}

function parseKeyValueTokens(tokens) {
    const parsed = {};
    for (const token of tokens) {
        const eq = token.indexOf('=');
        if (eq <= 0) continue;
        const key = token.slice(0, eq).trim();
        const raw = token.slice(eq + 1).trim();
        if (!key || !raw) continue;
        const unquoted = raw.replace(/^['"]|['"]$/g, '');
        const num = Number(unquoted);
        parsed[key] = Number.isFinite(num) ? num : unquoted;
    }
    return parsed;
}

function parseMlCommand(input) {
    const text = String(input || '').trim();
    if (!text.toLowerCase().startsWith('/ml')) return null;
    const lower = text.toLowerCase();
    if (lower === '/ml' || lower === '/ml help') {
        return { type: 'help' };
    }
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
        return { type: 'invalid', reason: 'Use: /ml predict ... OR /ml retrain inputCsv=ohlcv_sample.csv' };
    }
    const action = String(parts[1] || '').toLowerCase();
    if (action !== 'predict' && action !== 'retrain') {
        return { type: 'invalid', reason: 'Supported: /ml predict, /ml retrain' };
    }
    const inputs = parseKeyValueTokens(parts.slice(2));
    return { type: action, inputs };
}

function parseModelCommand(input) {
    const text = String(input || '').trim();
    if (!text.toLowerCase().startsWith('/model')) return null;

    const lower = text.toLowerCase();
    if (lower === '/model' || lower === '/model help' || lower === '/model catalog') {
        return { type: 'catalog' };
    }

    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
        return { type: 'invalid', reason: 'Use: /model <finance|defense> <modelId> key=value ...' };
    }

    const domain = String(parts[1] || '').toLowerCase();
    const modelId = String(parts[2] || '').toLowerCase();
    const inputs = parseKeyValueTokens(parts.slice(3));
    return { type: 'run', domain, modelId, inputs };
}

function formatCatalogText(catalogPayload) {
    const cat = catalogPayload?.catalog || {};
    const blocks = ['**Model Catalog**', ''];
    for (const [domain, domainMeta] of Object.entries(cat)) {
        blocks.push(`### ${escapeHtml(domainMeta?.title || domain)}`);
        const models = Array.isArray(domainMeta?.models) ? domainMeta.models : [];
        if (models.length === 0) {
            blocks.push('- No models');
            blocks.push('');
            continue;
        }
        for (const m of models) {
            const id = escapeHtml(String(m.id || ''));
            const name = escapeHtml(String(m.name || id));
            const inputs = Array.isArray(m.inputs) ? m.inputs.join(', ') : '';
            blocks.push(`- \`${id}\` — ${name}${inputs ? ` (inputs: ${escapeHtml(inputs)})` : ''}`);
        }
        blocks.push('');
    }
    blocks.push('Use: `/model <finance|defense> <modelId> key=value ...`');
    blocks.push('Example: `/model finance loan_emi principal=500000 annualRate=9 years=20`');
    return blocks.join('\n');
}

function formatModelResultText(payload) {
    const result = payload?.result || {};
    const outputs = result?.outputs && typeof result.outputs === 'object' ? result.outputs : {};
    const outputLines = Object.entries(outputs).map(([k, v]) => `- **${escapeHtml(k)}:** ${escapeHtml(String(v))}`);
    return [
        `**${escapeHtml(String(payload?.domain || '').toUpperCase())} • ${escapeHtml(String(payload?.modelId || ''))}**`,
        '',
        '**Simple Explanation**',
        escapeHtml(String(result.explanationSimple || 'No explanation generated.')),
        '',
        '**Core Outputs**',
        ...(outputLines.length > 0 ? outputLines : ['- No outputs']),
        '',
        '**Technical Note**',
        escapeHtml(String(result.explanationTechnical || 'N/A')),
        '',
        '**Assumptions**',
        ...((Array.isArray(result.assumptions) && result.assumptions.length > 0)
            ? result.assumptions.map((x) => `- ${escapeHtml(String(x))}`)
            : ['- None']),
        '',
        '**Disclaimer**',
        escapeHtml(String(result.disclaimer || 'Educational use only.'))
    ].join('\n');
}

async function runModelCommand(cmd) {
    if (!cmd) return;
    if (cmd.type === 'invalid') {
        addMessage('assistant', `⚠️ ${cmd.reason}`, []);
        return;
    }

    try {
        if (cmd.type === 'catalog') {
            const res = await fetch('/api/models/catalog');
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Catalog fetch failed');
            addMessage('assistant', formatCatalogText(json), []);
            return;
        }

        const res = await fetch('/api/models/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                domain: cmd.domain,
                modelId: cmd.modelId,
                inputs: cmd.inputs || {}
            })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Model run failed');
        addMessage('assistant', formatModelResultText(json), []);
    } catch (error) {
        addMessage('assistant', `⚠️ Model command failed: ${error.message}`, []);
    }
}

function formatMlHelpText() {
    return [
        '**ML Finance Commands**',
        '',
        '- `/ml predict open=101 high=103 low=99 close=102 prevClose=100 volume=120000`',
        '- `/ml retrain inputCsv=ohlcv_sample.csv`',
        '',
        'Required fields: `open`, `high`, `low`, `close`, `prevClose`, `volume`',
        '',
        'Output includes direction/probabilities for predict and metrics for retrain.'
    ].join('\n');
}

function formatMlPredictionText(payload) {
    const p = payload?.prediction || {};
    return [
        '**ML Finance Prediction**',
        '',
        `- **Direction:** ${escapeHtml(String(p.prediction || 'unknown')).toUpperCase()}`,
        `- **Probability Up:** ${escapeHtml(String(p.probability_up ?? '-'))}`,
        `- **Probability Down:** ${escapeHtml(String(p.probability_down ?? '-'))}`,
        `- **Confidence:** ${escapeHtml(String(p.confidence || 'unknown'))}`,
        '',
        '**Simple Explanation**',
        escapeHtml(String(p.explanation_simple || 'No explanation generated.')),
        '',
        '**Disclaimer**',
        escapeHtml(String(p.disclaimer || 'Educational ML output only.'))
    ].join('\n');
}

function formatMlRetrainText(payload) {
    const retrain = payload?.retrain || {};
    const report = retrain?.report || {};
    const metrics = report?.metrics || {};
    const importance = report?.feature_importance || {};
    const topFeatures = Object.entries(importance)
        .slice(0, 5)
        .map(([k, v]) => `- ${escapeHtml(String(k))}: ${escapeHtml(String(Number(v).toFixed(4)))}`);
    return [
        '**ML Finance Retrain Completed**',
        '',
        `- **Input CSV:** ${escapeHtml(String(retrain.inputCsv || '-'))}`,
        `- **Model File:** ${escapeHtml(String(retrain.modelFile || '-'))}`,
        `- **Report File:** ${escapeHtml(String(retrain.reportFile || '-'))}`,
        '',
        '**Metrics**',
        `- Accuracy: ${escapeHtml(String(metrics.accuracy ?? '-'))}`,
        `- Precision: ${escapeHtml(String(metrics.precision ?? '-'))}`,
        `- Recall: ${escapeHtml(String(metrics.recall ?? '-'))}`,
        `- ROC AUC: ${escapeHtml(String(metrics.roc_auc ?? '-'))}`,
        '',
        '**Top Feature Importance**',
        ...(topFeatures.length > 0 ? topFeatures : ['- No feature importance available']),
        '',
        '**Disclaimer**',
        escapeHtml(String(report.disclaimer || 'Educational ML baseline only.'))
    ].join('\n');
}

async function runMlCommand(cmd) {
    if (!cmd) return;
    if (cmd.type === 'invalid') {
        addMessage('assistant', `⚠️ ${cmd.reason}`, []);
        return;
    }
    if (cmd.type === 'help') {
        addMessage('assistant', formatMlHelpText(), []);
        return;
    }
    try {
        if (cmd.type === 'predict') {
            const res = await fetch('/api/ml/finance/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cmd.inputs || {})
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'ML prediction failed.');
            addMessage('assistant', formatMlPredictionText(json), []);
            return;
        }

        if (cmd.type === 'retrain') {
            const res = await fetch('/api/ml/finance/retrain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cmd.inputs || {})
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'ML retrain failed.');
            addMessage('assistant', formatMlRetrainText(json), []);
            return;
        }

        addMessage('assistant', '⚠️ Unsupported ML action.', []);
    } catch (error) {
        addMessage('assistant', `⚠️ ML command failed: ${error.message}`, []);
    }
}

function parseEmailCommand(input) {
    const text = String(input || '').trim();
    if (!text) return null;

    const patterns = [
        /^(?:please\s+)?(?:send\s+)?(?:an?\s+)?(?:email|mail)(?:\s+to)?\s+(.+?)\s+(?:with\s+)?subject\s+(.+?)\s+(?:with\s+)?(?:message|body|content)\s+(.+)$/i,
        /^(?:please\s+)?(?:send\s+)?(?:an?\s+)?(?:email|mail)(?:\s+to)?\s+(.+?)\s+(?:saying|that says)\s+(.+)$/i
    ];

    for (const p of patterns) {
        const m = text.match(p);
        if (!m) continue;

        const recipientRaw = String(m[1] || '').trim();
        let subject = '';
        let body = '';
        if (m.length >= 4) {
            subject = String(m[2] || '').trim();
            body = String(m[3] || '').trim();
        } else {
            subject = 'Message from Mate AI';
            body = String(m[2] || '').trim();
        }

        const recipients = extractRecipients(recipientRaw);
        if (recipients.length === 0) {
            return null;
        }
        return {
            to: recipients.join(','),
            subject,
            body
        };
    }
    return null;
}

function extractRecipients(raw) {
    const spoken = normalizeSpokenEmailText(raw);
    const directMatches = spoken.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    if (directMatches.length > 0) {
        return Array.from(new Set(directMatches.map(v => v.toLowerCase())));
    }

    const parts = spoken
        .split(/\s*(?:,|;|\sand\s)\s*/i)
        .map(v => normalizeSpokenEmailText(v))
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
    return parts.filter(v => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v));
}

function normalizeSpokenEmailText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+at\s+/g, '@')
        .replace(/\s+dot\s+/g, '.')
        .replace(/\s+underscore\s+/g, '_')
        .replace(/\s+hyphen\s+/g, '-')
        .replace(/\s+dash\s+/g, '-')
        .replace(/\s+plus\s+/g, '+')
        .replace(/\s+/g, '')
        .replace(/,+/g, ',')
        .trim();
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioFile = new File([audioBlob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
            addAttachment(audioFile);

            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        micBtn.classList.add('recording');
        micBtn.title = 'Stop recording';
    } catch (error) {
        console.error('Recording error:', error);
        alert('Could not access microphone. Please allow microphone access.');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isRecording = false;
    micBtn.classList.remove('recording');
    micBtn.title = 'Record audio';
}

// ========== DRAG & DROP ==========

function setupDragAndDrop() {
    const overlay = document.createElement('div');
    overlay.className = 'drag-overlay';
    overlay.innerHTML = '<span class="drag-overlay-text">📎 Drop files here</span>';
    document.body.appendChild(overlay);

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        overlay.classList.add('active');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            overlay.classList.remove('active');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove('active');

        const files = Array.from(e.dataTransfer.files);
        files.forEach(file => addAttachment(file));
    });
}

// ========== UTILITIES ==========

function scrollToBottom() {
    requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
}

function clearChat() {
    currentChatId = null;
    loadChatHistory();

    // Reset UI
    messagesEl.innerHTML = '';

    // Re-add welcome screen
    const welcome = document.createElement('div');
    welcome.className = 'welcome-screen';
    welcome.id = 'welcomeScreen';
    welcome.innerHTML = `
    <div class="welcome-icon">🤝</div>
    <h2>Hey there, Brother!</h2>
    <p>I'm <strong>Mate AI</strong> — your personalized AI companion. Let's discuss anything — tech, startups, sports, finance, life, or just brainstorm wild ideas together!</p>
    <div class="quick-prompts">
      <button class="quick-prompt" data-prompt="What's the hottest tech trend right now that could become a startup opportunity?">🚀 Startup Ideas</button>
      <button class="quick-prompt" data-prompt="Let's brainstorm a unique app idea that solves a real problem.">💡 Brainstorm</button>
      <button class="quick-prompt" data-prompt="What are some smart money tips for someone in their 20s?">💰 Money Tips</button>
      <button class="quick-prompt" data-prompt="What's happening in the world of AI and where is it heading?">🤖 AI Trends</button>
      <button class="quick-prompt" data-prompt="Help me debug this code and suggest a clean fix with explanation.">💻 Code Help</button>
      <button class="quick-prompt" data-prompt="Help me troubleshoot a networking issue step by step (DNS, latency, routing, firewall).">🌐 Networking Help</button>
      <button class="quick-prompt" data-prompt="/model catalog">📚 Model Catalog</button>
      <button class="quick-prompt" data-prompt="/ml predict open=101 high=103 low=99 close=102 prevClose=100 volume=120000">📊 ML Predict</button>
      <button class="quick-prompt" data-prompt="/ml retrain inputCsv=ohlcv_sample.csv">🧠 ML Retrain</button>
      <button class="quick-prompt" data-prompt="/model finance position_size_risk capital=200000 riskPct=1 entryPrice=250 stopLossPrice=240">📉 Trade Risk Plan</button>
      <button class="quick-prompt" data-prompt="/model defense readiness_score personnelReadyPct=82 equipmentReadyPct=71 trainingHoursPerMonth=28 logisticsDays=16">🛡️ Defense Model</button>
    </div>
  `;
    messagesEl.appendChild(welcome);

    // Re-attach quick prompt listeners
    welcome.querySelectorAll('.quick-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            messageInput.value = btn.dataset.prompt;
            autoResizeTextarea();
            sendMessage();
        });
    });

    sidebar.classList.remove('open');
    messageInput.focus();
}

function refreshApp() {
    window.location.reload();
}

function closeStackModal() {
    if (!stackModal) return;
    stackModal.classList.remove('open');
    stackModal.setAttribute('aria-hidden', 'true');
}

async function openStackModal() {
    if (!stackModal || !stackContent) return;
    stackModal.classList.add('open');
    stackModal.setAttribute('aria-hidden', 'false');
    stackContent.innerHTML = '<div class="stack-loading">Loading stack details...</div>';

    try {
        const res = await fetch('/api/system/stack');
        if (!res.ok) throw new Error('Failed to fetch stack data');
        const data = await res.json();

        const libRows = Object.entries(data.libraries || {})
            .map(([name, version]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(String(version))}</td></tr>`)
            .join('');

        const extensionRows = (data.extensions || [])
            .map((e) => `<li>${escapeHtml(e.name)} <span>${e.enabled ? 'ON' : 'OFF'}</span></li>`)
            .join('');

        const sourceRows = (data.extracted?.sources || [])
            .map((s) => `<tr><td>${escapeHtml(s.sourceId)}</td><td>${escapeHtml(String(s.chunkCount))}</td></tr>`)
            .join('');
        const uploadRows = (data.extracted?.uploads || [])
            .map((u) => `<tr><td>${escapeHtml(u.file)}</td><td>${escapeHtml(String(u.size))}</td><td>${escapeHtml(String(u.indexedChunks))}</td></tr>`)
            .join('');
        const outsourcedRows = (data.outsourced?.webDomains || [])
            .map((d) => `<li>${escapeHtml(d)}</li>`)
            .join('');

        stackContent.innerHTML = `
          <div class="stack-section">
            <h4>Runtime</h4>
            <p>${escapeHtml(data.app?.name || 'Mate AI')} · ${escapeHtml(data.app?.runtime || '')}</p>
          </div>
          <div class="stack-section">
            <h4>AI Providers</h4>
            <ul class="stack-list">
              <li>Groq <span>${data.providers?.groq?.enabled ? 'ON' : 'OFF'}</span></li>
              <li>Groq Model <span>${escapeHtml(data.providers?.groq?.model || 'unknown')}</span></li>
              <li>Ollama <span>${data.providers?.ollama?.available ? 'ON' : 'OFF'}</span></li>
              <li>Ollama Version <span>${escapeHtml(data.providers?.ollama?.version || 'not found')}</span></li>
            </ul>
          </div>
          <div class="stack-section">
            <h4>Extensions</h4>
            <ul class="stack-list">${extensionRows || '<li>None</li>'}</ul>
          </div>
          <div class="stack-section">
            <h4>Libraries & Packages</h4>
            <table class="stack-table">
              <thead><tr><th>Package</th><th>Version</th></tr></thead>
              <tbody>${libRows || '<tr><td colspan="2">No dependencies</td></tr>'}</tbody>
            </table>
          </div>
          <div class="stack-section">
            <h4>Extracted Data</h4>
            <p>Sources: ${escapeHtml(String(data.extracted?.totalSources || 0))} · Chunks: ${escapeHtml(String(data.extracted?.totalChunks || 0))}</p>
            <table class="stack-table">
              <thead><tr><th>Source</th><th>Chunks</th></tr></thead>
              <tbody>${sourceRows || '<tr><td colspan="2">No extracted sources yet</td></tr>'}</tbody>
            </table>
            <table class="stack-table">
              <thead><tr><th>Uploaded File</th><th>Bytes</th><th>Indexed</th></tr></thead>
              <tbody>${uploadRows || '<tr><td colspan="3">No uploaded files found in /uploads</td></tr>'}</tbody>
            </table>
          </div>
          <div class="stack-section">
            <h4>Outsourced Web Sources</h4>
            <p>Unique domains used by web retrieval: ${escapeHtml(String(data.outsourced?.webDomainsCount || 0))}</p>
            <ul class="stack-list">${outsourcedRows || '<li>No web domains captured yet (send a web-grounded query first)</li>'}</ul>
          </div>
        `;
    } catch (error) {
        stackContent.innerHTML = `<div class="stack-loading">Failed to load stack details.</div>`;
    }
}

function closeProfileModal() {
    if (!profileModal) return;
    profileModal.classList.remove('open');
    profileModal.setAttribute('aria-hidden', 'true');
}

async function openProfileModal() {
    if (!profileModal || !profileStatus) return;
    profileModal.classList.add('open');
    profileModal.setAttribute('aria-hidden', 'false');
    profileStatus.textContent = 'Loading profile...';
    await loadGoogleProfileState();
}

function renderGoogleProfileCard() {
    const profile = googleProfileState || {};
    const fallback = 'https://via.placeholder.com/80x80.png?text=User';
    const img = profile.customPicture || profile.picture || fallback;
    if (profileImage) profileImage.src = img;
    if (profileName) profileName.textContent = profile.name || 'Not connected';
    if (profileEmail) profileEmail.textContent = profile.email || '-';
}

async function loadGoogleProfileState() {
    if (!profileStatus) return;
    try {
        const [configRes, profileRes] = await Promise.all([
            fetch('/api/google/profile/config'),
            fetch('/api/google/profile')
        ]);
        if (!configRes.ok || !profileRes.ok) {
            throw new Error('Failed loading profile state');
        }
        const config = await configRes.json();
        const payload = await profileRes.json();
        googleProfileState = payload.profile || {};

        const updatedAt = Number(payload.updatedAt || 0);
        const updatedAtText = updatedAt ? new Date(updatedAt).toLocaleString() : 'never';

        if (!config.configured) {
            profileStatus.textContent = 'Google OAuth is not configured on server. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.';
        } else if (!config.connected) {
            profileStatus.textContent = 'Gmail not connected. Click "Connect Gmail".';
        } else {
            profileStatus.textContent = `Connected. Profile synced: ${updatedAtText}.`;
        }
        renderGoogleProfileCard();
    } catch (e) {
        profileStatus.textContent = 'Failed to load profile.';
        googleProfileState = null;
        renderGoogleProfileCard();
    }
}

async function connectGoogleProfile() {
    try {
        const res = await fetch('/api/google/profile/auth-url');
        const json = await res.json();
        if (!res.ok) {
            throw new Error(json.error || 'Google auth URL failed');
        }

        profileStatus.textContent = 'Opening Google connect flow...';
        const popup = window.open(json.url, '_blank', 'noopener,noreferrer,width=520,height=720');
        if (!popup) {
            window.location.href = json.url;
            return;
        }

        const timer = setInterval(async () => {
            if (popup.closed) {
                clearInterval(timer);
                profileStatus.textContent = 'Checking connection...';
                await loadGoogleProfileState();
            }
        }, 700);
    } catch (e) {
        profileStatus.textContent = `Connect failed: ${e.message}`;
    }
}

async function syncGoogleProfile() {
    if (!profileStatus) return;
    profileStatus.textContent = 'Syncing profile...';
    try {
        const res = await fetch('/api/google/profile/sync', { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Sync failed');
        await loadGoogleProfileState();
    } catch (e) {
        profileStatus.textContent = `Sync failed: ${e.message}`;
    }
}

async function uploadProfilePhoto() {
    if (!profilePhotoInput || !profilePhotoInput.files || profilePhotoInput.files.length === 0) return;
    const file = profilePhotoInput.files[0];
    if (!file.type.startsWith('image/')) {
        profileStatus.textContent = 'Please select an image file.';
        return;
    }
    profileStatus.textContent = 'Uploading photo...';
    try {
        const formData = new FormData();
        formData.append('photo', file);
        const res = await fetch('/api/google/profile/photo', { method: 'POST', body: formData });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Photo upload failed');
        if (!googleProfileState) googleProfileState = {};
        googleProfileState.customPicture = json.customPicture || '';
        renderGoogleProfileCard();
        profileStatus.textContent = 'Photo uploaded.';
    } catch (e) {
        profileStatus.textContent = `Photo upload failed: ${e.message}`;
    } finally {
        profilePhotoInput.value = '';
    }
}

async function disconnectGoogleProfile() {
    if (!profileStatus) return;
    profileStatus.textContent = 'Disconnecting Google account...';
    try {
        const res = await fetch('/api/google/profile/disconnect', { method: 'POST' });
        if (!res.ok) throw new Error('Disconnect failed');
        await loadGoogleProfileState();
    } catch (e) {
        profileStatus.textContent = `Disconnect failed: ${e.message}`;
    }
}

function closeMedicalModal() {
    if (!medicalModal) return;
    medicalModal.classList.remove('open');
    medicalModal.setAttribute('aria-hidden', 'true');
}

function openMedicalModal() {
    if (!medicalModal) return;
    medicalModal.classList.add('open');
    medicalModal.setAttribute('aria-hidden', 'false');
    if (medicalStatus) medicalStatus.textContent = 'Enter parameters and run analysis.';
}

function readNumberField(id) {
    const el = document.getElementById(id);
    if (!el) return undefined;
    const value = String(el.value || '').trim();
    if (!value) return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}

function readMedicalPayload() {
    return {
        age: readNumberField('medicalAge'),
        diet: String(document.getElementById('medicalDiet')?.value || '').trim(),
        bloodPressure: {
            systolic: readNumberField('medicalSystolic'),
            diastolic: readNumberField('medicalDiastolic')
        },
        bloodTests: {
            hba1c: readNumberField('medicalHba1c'),
            fastingGlucose: readNumberField('medicalFastingGlucose'),
            ldl: readNumberField('medicalLdl'),
            hdl: readNumberField('medicalHdl'),
            triglycerides: readNumberField('medicalTriglycerides'),
            hemoglobin: readNumberField('medicalHemoglobin'),
            crp: readNumberField('medicalCrp'),
            wbc: readNumberField('medicalWbc')
        },
        hereditary: {
            diabetes: Boolean(document.getElementById('heredDiabetes')?.checked),
            hypertension: Boolean(document.getElementById('heredHypertension')?.checked),
            heart_disease: Boolean(document.getElementById('heredHeartDisease')?.checked),
            stroke: Boolean(document.getElementById('heredStroke')?.checked),
            cancer: Boolean(document.getElementById('heredCancer')?.checked)
        }
    };
}

function compactObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const next = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object' && !Array.isArray(value)) {
            const nested = compactObject(value);
            if (Object.keys(nested).length === 0) continue;
            next[key] = nested;
            continue;
        }
        next[key] = value;
    }
    return next;
}

function renderMedicalAnalysis(analysis) {
    if (!medicalResult) return;
    const risk = String(analysis?.overallRisk || 'unknown').toLowerCase();
    const riskClass = `medical-risk-tag medical-risk-${escapeHtml(risk)}`;
    const bp = analysis?.bloodPressure || {};
    const bpLabel = bp.available
        ? `${escapeHtml(String(bp.systolic))}/${escapeHtml(String(bp.diastolic))} (${escapeHtml(String(bp.category || 'unknown'))})`
        : 'Not provided';
    const signals = Array.isArray(analysis?.conditionSignals) ? analysis.conditionSignals : [];
    const recommendations = Array.isArray(analysis?.recommendations) ? analysis.recommendations : [];

    const signalsHtml = signals.length > 0
        ? `<ul>${signals.map((s) => `<li><strong>${escapeHtml(String(s.condition || 'Condition'))}</strong>: ${escapeHtml(String(s.risk || 'unknown'))} risk${Array.isArray(s.reasons) && s.reasons.length > 0 ? ` (${escapeHtml(s.reasons.join('; '))})` : ''}</li>`).join('')}</ul>`
        : '<div class="contacts-status">No major condition flags found from provided inputs.</div>';
    const recommendationsHtml = recommendations.length > 0
        ? `<ul>${recommendations.map((r) => `<li>${escapeHtml(String(r || ''))}</li>`).join('')}</ul>`
        : '<div class="contacts-status">No recommendations generated.</div>';

    medicalResult.innerHTML = `
      <div class="medical-metric">
        <span>Overall Risk</span>
        <span class="${riskClass}">${escapeHtml(risk)}</span>
      </div>
      <div class="medical-metric">
        <span>Risk Score</span>
        <strong>${escapeHtml(String(analysis?.riskScore ?? '-'))}/100</strong>
      </div>
      <div class="medical-metric">
        <span>Blood Pressure</span>
        <strong>${bpLabel}</strong>
      </div>
      <div class="medical-block">
        <h4>Condition Signals</h4>
        ${signalsHtml}
      </div>
      <div class="medical-block">
        <h4>Recommendations</h4>
        ${recommendationsHtml}
      </div>
      <div class="medical-block">
        <h4>Safety Note</h4>
        <div class="contacts-status">${escapeHtml(String(analysis?.disclaimer || 'This is a risk-screening tool, not a diagnosis.'))}</div>
      </div>
    `;
}

async function submitMedicalAnalysis(e) {
    e.preventDefault();
    if (!medicalStatus) return;
    const payload = compactObject(readMedicalPayload());

    if (!Number.isFinite(Number(payload.age))) {
        medicalStatus.textContent = 'Age is required for analysis.';
        return;
    }

    if (medicalAnalyzeBtn) medicalAnalyzeBtn.disabled = true;
    medicalStatus.textContent = 'Analyzing medical risk...';
    if (medicalResult) medicalResult.innerHTML = '';

    try {
        const res = await fetch('/api/medical/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok) {
            throw new Error(json.error || 'Medical analysis failed.');
        }
        renderMedicalAnalysis(json.analysis || {});
        medicalStatus.textContent = 'Analysis complete.';
    } catch (error) {
        medicalStatus.textContent = `Analysis failed: ${error.message}`;
    } finally {
        if (medicalAnalyzeBtn) medicalAnalyzeBtn.disabled = false;
    }
}

function resetMedicalForm() {
    if (medicalForm) medicalForm.reset();
    if (medicalStatus) medicalStatus.textContent = 'Enter parameters and run analysis.';
    if (medicalResult) medicalResult.innerHTML = '';
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('json')) return '📊';
    if (mimeType.includes('csv') || mimeType.includes('spreadsheet')) return '📈';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    return '📄';
}

function truncateFilename(name, maxLength) {
    if (name.length <= maxLength) return name;
    const ext = name.split('.').pop();
    const base = name.slice(0, maxLength - ext.length - 4);
    return `${base}...${ext}`;
}
