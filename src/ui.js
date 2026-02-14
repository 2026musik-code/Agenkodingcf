// State
let selectedFiles = new Map(); // path -> content
let currentRepo = { owner: '', repo: '' };

// DOM Elements
const settingsModal = document.getElementById('settingsModal');
const settingsContent = document.getElementById('settingsContent');
const settingsBtn = document.getElementById('settingsBtn');
const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
const desktopSettingsBtn = document.getElementById('desktopSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
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

// Markdown Setup
marked.setOptions({
    highlight: function(code, lang) {
        const language = highlight.getLanguage(lang) ? lang : 'plaintext';
        return highlight.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
});

// --- Mobile Sidebar Logic ---

function toggleSidebar(show) {
    if (show) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.remove('hidden');
        setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10);
    } else {
        sidebar.classList.add('-translate-x-full');
        sidebarOverlay.classList.add('opacity-0');
        setTimeout(() => sidebarOverlay.classList.add('hidden'), 300);
    }
}

mobileMenuBtn?.addEventListener('click', () => toggleSidebar(true));
closeSidebarBtn?.addEventListener('click', () => toggleSidebar(false));
sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));


// --- Settings Logic ---

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

// Bind both desktop and mobile settings buttons if they exist
settingsBtn?.addEventListener('click', () => toggleSettings(true));
desktopSettingsBtn?.addEventListener('click', () => toggleSettings(true));
mobileSettingsBtn?.addEventListener('click', () => toggleSettings(true));
closeSettingsBtn?.addEventListener('click', () => toggleSettings(false));

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.ferdevApiKey) apiKeyInput.value = data.ferdevApiKey;
        if (data.githubToken) githubTokenInput.value = data.githubToken;
        if (data.proxyUrl) proxyUrlInput.value = data.proxyUrl;
    } catch (e) {
        console.error('Failed to load config', e);
    }
}

saveSettingsBtn.addEventListener('click', async () => {
    const ferdevApiKey = apiKeyInput.value;
    const githubToken = githubTokenInput.value;
    const proxyUrl = proxyUrlInput.value;

    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    saveSettingsBtn.disabled = true;

    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ferdevApiKey, githubToken, proxyUrl })
        });
        toggleSettings(false);
        addMessage('system', 'Configuration saved successfully.');
    } catch (e) {
        alert('Failed to save configuration');
    } finally {
        saveSettingsBtn.textContent = originalText;
        saveSettingsBtn.disabled = false;
    }
});

// --- GitHub Logic ---

loadRepoBtn.addEventListener('click', async () => {
    const input = repoInput.value.trim();
    if (!input) return;
    const [owner, repo] = input.split('/');
    if (!owner || !repo) {
        alert('Invalid repository format. Use owner/repo');
        return;
    }

    const originalHtml = loadRepoBtn.innerHTML;
    loadRepoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
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
        renderFileTree(data.tree);
        addMessage('system', `Loaded repository: ${owner}/${repo}`);

        // On mobile, auto-close sidebar after load so user sees chat area
        if (window.innerWidth < 768) {
             toggleSidebar(false);
        }

    } catch (e) {
        fileTree.innerHTML = `<div class="p-4 text-red-400 text-center text-sm">Error: ${e.message}</div>`;
    } finally {
        loadRepoBtn.innerHTML = originalHtml;
    }
});

function renderFileTree(tree) {
    fileTree.innerHTML = '';
    // Sort: folders first, then files
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

        if (item.type === 'blob') { // File
            li.addEventListener('click', () => toggleFileSelection(item.path, li));
        }

        list.appendChild(li);
    });
    fileTree.appendChild(list);
}

async function toggleFileSelection(path, element) {
    if (selectedFiles.has(path)) {
        selectedFiles.delete(path);
        element.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');
        element.classList.add('text-gray-200');
    } else {
        // Fetch content
        const originalHtml = element.innerHTML;
        element.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary mr-2"></i> Loading...';
        try {
            const res = await fetch('/api/github/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path })
            });
            if (!res.ok) throw new Error('Failed to fetch file');
            const data = await res.json();

            selectedFiles.set(path, data.content);
            element.classList.add('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');
            element.classList.remove('text-gray-200');

            // Revert html but keep styles
            element.innerHTML = `<i class="fa-regular fa-file text-blue-400 mr-2.5"></i><span class="truncate">${path}</span>`;

        } catch (e) {
            alert(e.message);
            element.innerHTML = originalHtml; // Revert on error
        }
    }
    updateContextCount();
}

function updateContextCount() {
    selectedCount.textContent = selectedFiles.size;
}

clearContextBtn.addEventListener('click', () => {
    selectedFiles.clear();
    updateContextCount();
    const lis = fileTree.querySelectorAll('li');
    lis.forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500'));
});


// --- Chat Logic ---

function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'flex items-start space-x-3 md:space-x-4 animate-fade-in-up mb-4';

    let icon = '';
    let bgClass = '';

    if (role === 'user') {
        icon = '<div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-700 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-user text-white text-xs md:text-sm"></i></div>';
        bgClass = 'bg-gray-800 text-white border border-gray-700';
    } else if (role === 'system') {
         icon = '<div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50 shrink-0"><i class="fa-solid fa-info text-yellow-500 text-xs md:text-sm"></i></div>';
         bgClass = 'bg-yellow-900/10 border border-yellow-600/20 text-yellow-200';
    } else {
        icon = '<div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-robot text-white text-xs md:text-sm"></i></div>';
        bgClass = 'glass text-gray-100 shadow-xl';
    }

    const bubble = document.createElement('div');
    bubble.className = `${bgClass} rounded-2xl p-3 md:p-4 max-w-[85%] md:max-w-3xl overflow-x-auto text-sm md:text-base leading-relaxed shadow-md`;
    if (role === 'user') bubble.classList.add('rounded-tr-none');
    else bubble.classList.add('rounded-tl-none');

    if (role === 'model' || role === 'system') {
        bubble.innerHTML = marked.parse(content);
        // Highlight code blocks
        bubble.querySelectorAll('pre code').forEach((block) => {
            highlight.highlightElement(block);
        });
    } else {
        bubble.textContent = content;
    }

    div.innerHTML = icon;
    div.appendChild(bubble);

    chatContainer.appendChild(div);
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
    // Reset textarea height if auto-expanding implemented later

    // Create loading message
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-msg';
    loadingDiv.className = 'flex items-start space-x-3 md:space-x-4 opacity-70 mb-4 animate-pulse';
    loadingDiv.innerHTML = `
        <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
            <i class="fa-solid fa-robot text-white text-xs md:text-sm"></i>
        </div>
        <div class="glass rounded-2xl rounded-tl-none p-3 md:p-4 text-sm md:text-base">
            <i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Thinking...
        </div>
    `;
    chatContainer.appendChild(loadingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const context = Array.from(selectedFiles.entries()).map(([path, content]) => ({ path, content }));

        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, contextFiles: context })
        });

        const data = await res.json();

        // Remove loading
        chatContainer.removeChild(loadingDiv);

        if (!res.ok) {
            addMessage('system', `Error: ${data.error || 'Unknown error'}`);
        } else {
            let reply = "No response text found.";
            if (typeof data === 'string') reply = data;
            else if (data.message) reply = data.message;
            else if (data.result) reply = data.result;
            else if (data.candidates && data.candidates[0].content) reply = data.candidates[0].content.parts[0].text;
            else reply = "```json\n" + JSON.stringify(data, null, 2) + "\n```";

            addMessage('model', reply);
        }

    } catch (e) {
        if (document.getElementById('loading-msg')) chatContainer.removeChild(loadingDiv);
        addMessage('system', `Network Error: ${e.message}`);
    }
}

// Initial Load
loadConfig();
