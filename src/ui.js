// State
let selectedFiles = new Map(); // path -> content
let currentRepo = { owner: '', repo: '' };

// DOM Elements
const settingsModal = document.getElementById('settingsModal');
const settingsContent = document.getElementById('settingsContent');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const githubTokenInput = document.getElementById('githubTokenInput');

const repoInput = document.getElementById('repoInput');
const loadRepoBtn = document.getElementById('loadRepoBtn');
const fileTree = document.getElementById('fileTree');
const selectedCount = document.getElementById('selectedCount');
const clearContextBtn = document.getElementById('clearContextBtn');

const chatContainer = document.getElementById('chatContainer');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');

// Markdown Setup
marked.setOptions({
    highlight: function(code, lang) {
        const language = highlight.getLanguage(lang) ? lang : 'plaintext';
        return highlight.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
});

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

settingsBtn.addEventListener('click', () => toggleSettings(true));
closeSettingsBtn.addEventListener('click', () => toggleSettings(false));

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.ferdevApiKey) apiKeyInput.value = data.ferdevApiKey;
        if (data.githubToken) githubTokenInput.value = data.githubToken;
    } catch (e) {
        console.error('Failed to load config', e);
    }
}

saveSettingsBtn.addEventListener('click', async () => {
    const ferdevApiKey = apiKeyInput.value;
    const githubToken = githubTokenInput.value;

    saveSettingsBtn.textContent = 'Saving...';
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ferdevApiKey, githubToken })
        });
        toggleSettings(false);
        addMessage('system', 'Configuration saved successfully.');
    } catch (e) {
        alert('Failed to save configuration');
    } finally {
        saveSettingsBtn.textContent = 'Save Configuration';
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

    loadRepoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    fileTree.innerHTML = '<div class="text-center text-gray-400 mt-4">Loading repository tree...</div>';

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
    } catch (e) {
        fileTree.innerHTML = `<div class="text-red-400 text-center mt-4">Error: ${e.message}</div>`;
    } finally {
        loadRepoBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
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
    list.className = 'space-y-1 text-sm';

    sorted.forEach(item => {
        const li = document.createElement('li');
        li.className = 'cursor-pointer hover:bg-gray-800 rounded px-2 py-1 truncate transition flex items-center';

        const icon = item.type === 'tree' ? '<i class="fa-regular fa-folder text-blue-400 mr-2"></i>' : '<i class="fa-regular fa-file text-gray-400 mr-2"></i>';
        li.innerHTML = `${icon}<span>${item.path}</span>`;

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
        element.classList.remove('bg-gray-700', 'text-white');
        element.classList.add('text-gray-200');
    } else {
        // Fetch content
        element.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-primary mr-2"></i>Loading...';
        try {
            const res = await fetch('/api/github/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path })
            });
            if (!res.ok) throw new Error('Failed to fetch file');
            const data = await res.json();

            selectedFiles.set(path, data.content);
            element.classList.add('bg-gray-700', 'text-white');
            element.classList.remove('text-gray-200');
        } catch (e) {
            alert(e.message);
        } finally {
            // Restore icon
            element.innerHTML = `<i class="fa-regular fa-file text-gray-400 mr-2"></i><span>${path}</span>`;
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
    // Re-render tree to clear highlights (simplistic approach)
    // Ideally we iterate DOM, but re-render is fine for now or just reload.
    // Let's just remove classes from all LIs
    const lis = fileTree.querySelectorAll('li');
    lis.forEach(li => li.classList.remove('bg-gray-700', 'text-white'));
});


// --- Chat Logic ---

function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'flex items-start space-x-4 animate-fade-in-up';

    let icon = '';
    let bgClass = '';

    if (role === 'user') {
        icon = '<div class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center shadow-lg"><i class="fa-solid fa-user text-white"></i></div>';
        bgClass = 'bg-gray-800 text-white border border-gray-700';
    } else if (role === 'system') {
         icon = '<div class="w-10 h-10 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50"><i class="fa-solid fa-info text-yellow-500"></i></div>';
         bgClass = 'bg-yellow-900/10 border border-yellow-600/20 text-yellow-200';
    } else {
        icon = '<div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg"><i class="fa-solid fa-robot text-white"></i></div>';
        bgClass = 'glass text-gray-100 shadow-xl';
    }

    const bubble = document.createElement('div');
    bubble.className = `${bgClass} rounded-2xl p-4 max-w-3xl overflow-x-auto`;
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

    // Create loading message
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-msg';
    loadingDiv.className = 'flex items-start space-x-4 opacity-50';
    loadingDiv.innerHTML = `
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <i class="fa-solid fa-robot text-white"></i>
        </div>
        <div class="glass rounded-2xl rounded-tl-none p-4">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Thinking...
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
            // Handle response format. If it's pure text or JSON with message field.
            // Adjust based on actual API response.
            // Assuming "message" or direct text if simple.
            // If the API returns the gemini response structure, it might be nested.
            // For now, let's dump the whole object if it's not clear, or try to find a text field.

            let reply = "No response text found.";
            if (typeof data === 'string') reply = data;
            else if (data.message) reply = data.message;
            else if (data.result) reply = data.result; // Common wrapper
            else if (data.candidates && data.candidates[0].content) reply = data.candidates[0].content.parts[0].text; // Google standard
            else reply = "```json\n" + JSON.stringify(data, null, 2) + "\n```"; // Fallback debug

            addMessage('model', reply);
        }

    } catch (e) {
        if (document.getElementById('loading-msg')) chatContainer.removeChild(loadingDiv);
        addMessage('system', `Network Error: ${e.message}`);
    }
}

// Initial Load
loadConfig();
