// State
let selectedFiles = new Map();
let currentRepo = { owner: '', repo: '' };
let currentRepoFiles = [];
let currentFile = { path: '', sha: '' };
let currentSessionId = Date.now().toString(); // Simple ID generation
let chatHistory = []; // Local mirror of messages

// DOM Elements
const settingsModal = document.getElementById('settingsModal');
const settingsContent = document.getElementById('settingsContent');
const settingsBtn = document.getElementById('settingsBtn');
const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
const desktopSettingsBtn = document.getElementById('desktopSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const githubUsernameInput = document.getElementById('githubUsernameInput');
const githubTokenInput = document.getElementById('githubTokenInput');
const proxyUrlInput = document.getElementById('proxyUrlInput');

const repoInput = document.getElementById('repoInput');
const loadRepoBtn = document.getElementById('loadRepoBtn');
const fileTree = document.getElementById('fileTree');
const selectedCount = document.getElementById('selectedCount');
const clearContextBtn = document.getElementById('clearContextBtn');

const chatContainer = document.getElementById('chatContainer');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');

const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

const modeManualBtn = document.getElementById('modeManualBtn');
const modeListBtn = document.getElementById('modeListBtn');
const manualRepoInputGroup = document.getElementById('manualRepoInputGroup');
const repoListGroup = document.getElementById('repoListGroup');
const repoSelect = document.getElementById('repoSelect');
const refreshReposBtn = document.getElementById('refreshReposBtn');
const createRepoBtn = document.getElementById('createRepoBtn');
const createRepoModal = document.getElementById('createRepoModal');
const confirmCreateRepoBtn = document.getElementById('confirmCreateRepoBtn');
const cancelCreateRepoBtn = document.getElementById('cancelCreateRepoBtn');
const newRepoName = document.getElementById('newRepoName');
const newRepoDesc = document.getElementById('newRepoDesc');
const newRepoPrivate = document.getElementById('newRepoPrivate');
const fileToolbar = document.getElementById('fileToolbar');
const saveFileBtn = document.getElementById('saveFileBtn');

// Tabs
const tabRepoBtn = document.getElementById('tabRepoBtn');
const tabHistoryBtn = document.getElementById('tabHistoryBtn');
const tabRepoContent = document.getElementById('tabRepoContent');
const tabHistoryContent = document.getElementById('tabHistoryContent');
const historyList = document.getElementById('historyList');
const newChatBtn = document.getElementById('newChatBtn');

// --- Markdown Renderer with "Save to Repo" Button ---
const renderer = new marked.Renderer();
const originalCodeRenderer = renderer.code;

renderer.code = function(code, language) {
    // Generate a unique ID for this block
    const blockId = 'code-' + Math.random().toString(36).substr(2, 9);

    // Highlight code
    let highlighted = code;
    if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(code, { language: language }).value;
    } else {
        highlighted = hljs.highlightAuto(code).value;
    }

    // Return the HTML with a relative wrapper and a button
    return `
        <div class="relative group my-4">
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition duration-200 z-10 flex space-x-2">
                 <button onclick="copyCode('${blockId}')" class="bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded shadow-md border border-gray-600 flex items-center" title="Copy to Clipboard">
                    <i class="fa-regular fa-copy mr-1"></i> Copy
                </button>
                <button onclick="saveCodeToRepo('${blockId}')" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-md border border-blue-500 flex items-center" title="Save to Repository">
                    <i class="fa-brands fa-github mr-1"></i> Save
                </button>
            </div>
            <pre><code id="${blockId}" class="hljs language-${language || 'plaintext'} p-4 rounded-lg block overflow-x-auto text-sm bg-[#282c34]">${highlighted}</code></pre>
            <textarea id="${blockId}-raw" class="hidden">${code}</textarea>
        </div>
    `;
};

marked.use({ renderer });

// Global functions for code block buttons
window.copyCode = function(id) {
    const raw = document.getElementById(id + '-raw').value;
    navigator.clipboard.writeText(raw).then(() => {
        addMessage('system', 'Code copied to clipboard!');
    });
};

window.saveCodeToRepo = async function(id) {
    const raw = document.getElementById(id + '-raw').value;
    const filename = prompt("Enter the path to save this file in your repository (e.g., src/index.js):");

    if (!filename) return;

    if (!currentRepo.owner || !currentRepo.repo) {
        alert("Please select a repository first!");
        return;
    }

    try {
        const res = await fetch('/api/github/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner: currentRepo.owner,
                repo: currentRepo.repo,
                path: filename,
                content: raw,
                message: `Create/Update ${filename} from AI Chat`
            })
        });

        if (!res.ok) throw new Error((await res.json()).error);

        addMessage('system', `Successfully saved <b>${filename}</b> to ${currentRepo.owner}/${currentRepo.repo}`);
        // Optionally refresh file tree if needed
        loadRepository(currentRepo.owner, currentRepo.repo);

    } catch (e) {
        alert(`Error saving file: ${e.message}`);
    }
};

// --- Mobile Sidebar ---
function toggleSidebar(show) {
    if (show) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.remove('hidden');
        setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10);
        // Refresh history when opening sidebar if needed
        if (!tabHistoryContent.classList.contains('hidden')) {
            loadHistoryList();
        }
    } else {
        sidebar.classList.add('-translate-x-full');
        sidebarOverlay.classList.add('opacity-0');
        setTimeout(() => sidebarOverlay.classList.add('hidden'), 300);
    }
}
mobileMenuBtn?.addEventListener('click', () => toggleSidebar(true));
closeSidebarBtn?.addEventListener('click', () => toggleSidebar(false));
sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));

// --- Tabs Logic ---
tabRepoBtn.addEventListener('click', () => {
    tabRepoBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium transition';
    tabHistoryBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white transition';
    tabRepoContent.classList.remove('hidden');
    tabHistoryContent.classList.add('hidden');
});

tabHistoryBtn.addEventListener('click', () => {
    tabHistoryBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium transition';
    tabRepoBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white transition';
    tabHistoryContent.classList.remove('hidden');
    tabRepoContent.classList.add('hidden');
    loadHistoryList();
});

// --- History Logic ---

async function loadHistoryList() {
    historyList.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
    try {
        const res = await fetch('/api/history/list');
        const data = await res.json();

        historyList.innerHTML = '';
        if (!data.chats || data.chats.length === 0) {
            historyList.innerHTML = '<div class="text-center text-gray-500 mt-4 text-xs">No history found.</div>';
            return;
        }

        data.chats.forEach(chat => {
            const btn = document.createElement('button');
            const date = new Date(chat.updated_at).toLocaleDateString();
            // Highlight current
            const isCurrent = chat.id === currentSessionId;
            const bgClass = isCurrent ? 'bg-blue-600/20 border-l-2 border-blue-500 text-blue-200' : 'hover:bg-gray-800/50 text-gray-300';

            btn.className = `w-full text-left px-3 py-2.5 rounded-lg text-xs transition mb-1 ${bgClass} truncate flex justify-between group`;
            btn.innerHTML = `
                <span class="truncate flex-1">Chat ${chat.id.substring(0, 8)}...</span>
                <span class="text-gray-600 text-[10px] ml-2">${date}</span>
                <i class="fa-solid fa-trash text-gray-600 hover:text-red-400 ml-2 opacity-0 group-hover:opacity-100 transition" onclick="deleteChat(event, '${chat.id}')"></i>
            `;
            btn.onclick = (e) => {
                 // Prevent triggering if trash clicked (handled by event bubbling check or separate handler,
                 // but innerHTML onclick is easier here given constraints)
                 if (e.target.classList.contains('fa-trash')) return;
                 loadChatSession(chat.id);
            };
            historyList.appendChild(btn);
        });

    } catch (e) {
        historyList.innerHTML = `<div class="text-center text-red-400 mt-4 text-xs">Error loading history</div>`;
    }
}

async function loadChatSession(id) {
    chatContainer.innerHTML = ''; // Clear UI
    chatHistory = []; // Clear local state
    currentSessionId = id;

    // Add loading indicator
    const loader = document.createElement('div');
    loader.className = 'text-center text-gray-500 mt-10';
    loader.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading chat...';
    chatContainer.appendChild(loader);

    try {
        const res = await fetch(`/api/history/${id}`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();

        chatContainer.removeChild(loader);

        if (data.messages && Array.isArray(data.messages)) {
            chatHistory = data.messages;
            chatHistory.forEach(msg => addMessageToUI(msg.role, msg.content));
        } else {
             addMessage('system', 'Chat history empty or invalid.');
        }

        // On mobile, close sidebar
        if (window.innerWidth < 768) toggleSidebar(false);

    } catch (e) {
        chatContainer.innerHTML = '';
        addMessage('system', `Error loading chat: ${e.message}`);
    }
}

async function deleteChat(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;

    try {
        await fetch(`/api/history/${id}`, { method: 'DELETE' });
        loadHistoryList(); // Refresh list
        if (id === currentSessionId) {
            startNewChat();
        }
    } catch (e) {
        alert('Failed to delete');
    }
}

function startNewChat() {
    currentSessionId = Date.now().toString();
    chatHistory = [];
    chatContainer.innerHTML = '';

    // Add Welcome Message
    const welcomeHTML = `
            <div class="flex items-start space-x-3 md:space-x-4 animate-fade-in-up">
                <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0">
                    <i class="fa-solid fa-robot text-white text-sm md:text-base"></i>
                </div>
                <div class="glass rounded-2xl rounded-tl-none p-3 md:p-4 max-w-[85%] md:max-w-3xl shadow-xl text-sm md:text-base">
                    <p>Hello! I am your AI Coding Agent. <br>Login in Settings to manage your GitHub repositories.</p>
                </div>
            </div>`;
    chatContainer.innerHTML = welcomeHTML;

    if (window.innerWidth < 768) toggleSidebar(false);
}

newChatBtn.addEventListener('click', startNewChat);

async function saveCurrentChat() {
    if (chatHistory.length === 0) return;
    try {
        await fetch(`/api/history/${currentSessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: chatHistory, updated_at: new Date().toISOString() })
        });
    } catch (e) {
        console.error('Auto-save failed', e);
    }
}


// --- Settings ---
function toggleSettings(show) {
    if (show) {
        settingsModal.classList.remove('hidden');
        setTimeout(() => {
            settingsContent.classList.remove('scale-95', 'opacity-0');
            settingsContent.classList.add('scale-100', 'opacity-100');
        }, 10);
    } else {
        settingsContent.classList.remove('scale-100', 'opacity-100');
        settingsContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            settingsModal.classList.add('hidden');
        }, 300);
    }
}
settingsBtn?.addEventListener('click', () => toggleSettings(true));
desktopSettingsBtn?.addEventListener('click', () => toggleSettings(true));
mobileSettingsBtn?.addEventListener('click', () => toggleSettings(true));
closeSettingsBtn?.addEventListener('click', () => toggleSettings(false));

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.githubUsername) githubUsernameInput.value = data.githubUsername;
        if (data.githubToken) githubTokenInput.value = data.githubToken;
        if (data.proxyUrl) proxyUrlInput.value = data.proxyUrl;
    } catch (e) {
        console.error('Failed to load config', e);
    }
}

saveSettingsBtn.addEventListener('click', async () => {
    const githubUsername = githubUsernameInput.value;
    const githubToken = githubTokenInput.value;
    const proxyUrl = proxyUrlInput.value;

    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    saveSettingsBtn.disabled = true;

    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ githubUsername, githubToken, proxyUrl })
        });
        toggleSettings(false);
        addMessage('system', 'Configuration saved successfully.');
        if (!modeListBtn.className.includes('text-gray-400')) {
            fetchMyRepos();
        }
    } catch (e) {
        alert('Failed to save configuration');
    } finally {
        saveSettingsBtn.textContent = originalText;
        saveSettingsBtn.disabled = false;
    }
});

// --- GitHub Logic ---
modeManualBtn.addEventListener('click', () => {
    modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition';
    modeListBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition';
    manualRepoInputGroup.classList.remove('hidden');
    repoListGroup.classList.add('hidden');
});

modeListBtn.addEventListener('click', () => {
    modeListBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition';
    modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition';
    manualRepoInputGroup.classList.add('hidden');
    repoListGroup.classList.remove('hidden');
    fetchMyRepos();
});

async function fetchMyRepos() {
    repoSelect.innerHTML = '<option>Loading...</option>';
    try {
        const res = await fetch('/api/github/list');
        if (!res.ok) throw new Error('Failed to fetch repos');
        const data = await res.json();

        repoSelect.innerHTML = '<option value="">Select a repository...</option>';
        data.repos.forEach(repo => {
            const opt = document.createElement('option');
            opt.value = repo.full_name;
            opt.textContent = `${repo.full_name} ${repo.private ? '(🔒)' : ''}`;
            repoSelect.appendChild(opt);
        });
    } catch (e) {
        repoSelect.innerHTML = `<option>Error: ${e.message}</option>`;
    }
}

refreshReposBtn.addEventListener('click', fetchMyRepos);

repoSelect.addEventListener('change', () => {
    const val = repoSelect.value;
    if (val) {
        const [owner, repo] = val.split('/');
        currentRepo = { owner, repo };
        loadRepository(owner, repo);
    }
});

loadRepoBtn.addEventListener('click', () => {
    const input = repoInput.value.trim();
    if (!input) return;
    const [owner, repo] = input.split('/');
    if (!owner || !repo) {
        alert('Invalid format');
        return;
    }
    loadRepository(owner, repo);
});

async function loadRepository(owner, repo) {
    fileTree.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mr-3"></i> Loading...</div>';

    try {
        const res = await fetch('/api/github/tree', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner, repo })
        });

        if (!res.ok) throw new Error((await res.json()).error);

        const data = await res.json();
        currentRepo = { owner, repo };
        currentRepoFiles = data.tree || [];
        renderFileTree(data.tree);
        addMessage('system', `Loaded repository: ${owner}/${repo}`);
        if (window.innerWidth < 768) toggleSidebar(false);

    } catch (e) {
        fileTree.innerHTML = `<div class="p-4 text-red-400 text-center text-sm">Error: ${e.message}</div>`;
    }
}

function renderFileTree(tree) {
    fileTree.innerHTML = '';
    if (!tree || tree.length === 0) {
        fileTree.innerHTML = '<div class="text-center text-gray-500 mt-4 text-sm">Empty repository.</div>';
        return;
    }
    const sorted = tree.sort((a, b) => {
        if (a.type === b.type) return a.path.localeCompare(b.path);
        return a.type === 'tree' ? -1 : 1;
    });

    const list = document.createElement('ul');
    list.className = 'space-y-1 text-sm p-2';

    sorted.forEach(item => {
        const li = document.createElement('li');
        li.className = 'cursor-pointer hover:bg-gray-800/50 rounded-lg px-3 py-2 truncate transition flex items-center select-none active:bg-gray-700';

        const icon = item.type === 'tree' ? '<i class="fa-regular fa-folder text-blue-400 mr-2.5"></i>' : '<i class="fa-regular fa-file text-gray-400 mr-2.5"></i>';
        li.innerHTML = `${icon}<span class="truncate">${item.path}</span>`;

        if (item.type === 'blob') {
            li.addEventListener('click', () => selectFile(item.path, li));
        }

        list.appendChild(li);
    });
    fileTree.appendChild(list);
}

async function selectFile(path, element) {
    const allLis = fileTree.querySelectorAll('li');
    allLis.forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500'));
    element.classList.add('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');

    try {
        const res = await fetch('/api/github/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path })
        });
        if (!res.ok) throw new Error('Failed to fetch file');
        const data = await res.json();

        selectedFiles.set(path, data.content);
        currentFile = { path, sha: data.sha };
        updateContextCount();
        fileToolbar.classList.remove('hidden');
        addMessage('system', `Selected: ${path}`);

    } catch (e) {
        alert(e.message);
    }
}

function updateContextCount() {
    selectedCount.textContent = selectedFiles.size;
}

clearContextBtn.addEventListener('click', () => {
    selectedFiles.clear();
    currentFile = { path: '', sha: '' };
    fileToolbar.classList.add('hidden');
    updateContextCount();
    const lis = fileTree.querySelectorAll('li');
    lis.forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500'));
});

saveFileBtn.addEventListener('click', async () => {
    if (!currentFile.path) return;
    const content = prompt("Confirm content to save:", selectedFiles.get(currentFile.path));
    if (content === null) return;

    saveFileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    try {
        const res = await fetch('/api/github/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner: currentRepo.owner,
                repo: currentRepo.repo,
                path: currentFile.path,
                content: content,
                sha: currentFile.sha,
                message: `Update ${currentFile.path} via AI Agent`
            })
        });

        if (!res.ok) throw new Error((await res.json()).error);

        const data = await res.json();
        selectedFiles.set(currentFile.path, content);
        addMessage('system', `Saved: ${currentFile.path}`);

    } catch (e) {
        alert(`Error: ${e.message}`);
    } finally {
        saveFileBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Save Changes';
    }
});

createRepoBtn.addEventListener('click', () => createRepoModal.classList.remove('hidden'));
cancelCreateRepoBtn.addEventListener('click', () => createRepoModal.classList.add('hidden'));

confirmCreateRepoBtn.addEventListener('click', async () => {
    const name = newRepoName.value.trim();
    if (!name) return alert('Name required');

    confirmCreateRepoBtn.disabled = true;
    confirmCreateRepoBtn.textContent = 'Creating...';

    try {
        const res = await fetch('/api/github/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description: newRepoDesc.value,
                private: newRepoPrivate.checked
            })
        });

        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();

        createRepoModal.classList.add('hidden');
        addMessage('system', `Repo created: ${data.repo}`);
        fetchMyRepos();

    } catch (e) {
        alert(`Error: ${e.message}`);
    } finally {
        confirmCreateRepoBtn.disabled = false;
        confirmCreateRepoBtn.textContent = 'Create';
    }
});

// --- Chat Logic (UI Improved) ---

function addMessage(role, content) {
    // Update State
    chatHistory.push({ role, content });
    addMessageToUI(role, content);
    if (role !== 'system') {
        saveCurrentChat();
    }
}

function addMessageToUI(role, content) {
    const div = document.createElement('div');
    // Align user right, others left
    if (role === 'user') {
        div.className = 'flex items-end justify-end space-x-2 space-x-reverse mb-4 animate-fade-in-up';
    } else {
        div.className = 'flex items-start justify-start space-x-3 md:space-x-4 mb-4 animate-fade-in-up';
    }

    let icon = '';
    let bgClass = '';
    let textClass = 'text-sm md:text-base leading-relaxed';

    if (role === 'user') {
        icon = '<div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shrink-0 order-last ml-2"><i class="fa-solid fa-user text-white text-xs"></i></div>';
        bgClass = 'bg-blue-600 text-white rounded-br-none';
    } else if (role === 'system') {
         icon = '<div class="w-8 h-8 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50 shrink-0"><i class="fa-solid fa-info text-yellow-500 text-xs"></i></div>';
         bgClass = 'bg-yellow-900/10 border border-yellow-600/20 text-yellow-200';
    } else {
        icon = '<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-robot text-white text-xs"></i></div>';
        bgClass = 'glass text-gray-100 shadow-xl rounded-tl-none';
    }

    const bubble = document.createElement('div');
    bubble.className = `${bgClass} rounded-2xl p-3 md:p-4 max-w-[85%] md:max-w-3xl overflow-x-auto ${textClass} shadow-md`;

    if (role === 'model' || role === 'system') {
        bubble.innerHTML = marked.parse(content);
        bubble.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } else {
        bubble.textContent = content;
    }

    if (role === 'user') {
        // Icon is appended in innerHTML logic for right alignment
        div.innerHTML = bubble.outerHTML + icon;
    } else {
        div.innerHTML = icon;
        div.appendChild(bubble);
    }

    chatContainer.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

sendBtn.addEventListener('click', sendMessage);
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const message = promptInput.value.trim();
    if (!message) return;

    addMessage('user', message);
    promptInput.value = '';

    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-msg';
    loadingDiv.className = 'flex items-start space-x-3 md:space-x-4 opacity-70 mb-4 animate-pulse';
    loadingDiv.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
            <i class="fa-solid fa-robot text-white text-xs"></i>
        </div>
        <div class="glass rounded-2xl rounded-tl-none p-3 md:p-4 text-sm md:text-base">
            <i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Thinking...
        </div>
    `;
    chatContainer.appendChild(loadingDiv);
    scrollToBottom();

    try {
        const context = Array.from(selectedFiles.entries()).map(([path, content]) => ({ path, content }));
        const fileTree = currentRepoFiles.map(f => f.path);

        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                contextFiles: context,
                repo: currentRepo,
                fileTree: fileTree
            })
        });

        const data = await res.json();
        chatContainer.removeChild(loadingDiv);

        if (!res.ok) {
            addMessage('system', `Error: ${data.error || 'Unknown error'}`);
        } else {
            let reply = data.result || "No response";
            addMessage('model', reply);
        }

    } catch (e) {
        if (document.getElementById('loading-msg')) chatContainer.removeChild(loadingDiv);
        addMessage('system', `Network Error: ${e.message}`);
    }
}

// Initial Load
loadConfig();
