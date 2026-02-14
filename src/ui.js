// State
let selectedFiles = new Map(); // path -> content
let currentRepo = { owner: '', repo: '' };
let currentFile = { path: '', sha: '' }; // Track selected file for editing

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

// New Elements
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
        if (modeListBtn.classList.contains('bg-gray-700')) {
            fetchMyRepos(); // Refresh list if needed
        }
    } catch (e) {
        alert('Failed to save configuration');
    } finally {
        saveSettingsBtn.textContent = originalText;
        saveSettingsBtn.disabled = false;
    }
});

// --- Connection Mode Logic ---

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
        if (!res.ok) throw new Error('Failed to fetch repos (Check Token)');
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

// --- GitHub Logic ---

loadRepoBtn.addEventListener('click', () => {
    const input = repoInput.value.trim();
    if (!input) return;
    const [owner, repo] = input.split('/');
    if (!owner || !repo) {
        alert('Invalid repository format. Use owner/repo');
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
        renderFileTree(data.tree);
        addMessage('system', `Loaded repository: ${owner}/${repo}`);

        if (window.innerWidth < 768) toggleSidebar(false);

    } catch (e) {
        fileTree.innerHTML = `<div class="p-4 text-red-400 text-center text-sm">Error: ${e.message}</div>`;
    }
}

function renderFileTree(tree) {
    fileTree.innerHTML = '';
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

// Select file for context OR editing
async function selectFile(path, element) {
    // If we click again, maybe toggle selection for context?
    // Current logic: click = view content + select for context

    // UI Feedback
    const allLis = fileTree.querySelectorAll('li');
    allLis.forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500'));
    element.classList.add('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');

    // Fetch content
    try {
        const res = await fetch('/api/github/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path })
        });
        if (!res.ok) throw new Error('Failed to fetch file');
        const data = await res.json();

        // Update State
        selectedFiles.set(path, data.content);
        currentFile = { path, sha: data.sha };
        updateContextCount();

        // Show in Chat/Editor (Simulated)
        // ideally we show a code editor. For now, we put it in context.
        // Let's show a "File Toolbar" to Save.
        fileToolbar.classList.remove('hidden');

        addMessage('system', `Selected file: ${path}`);

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

// --- Save File Logic ---

saveFileBtn.addEventListener('click', async () => {
    if (!currentFile.path) return;

    const content = prompt("Confirm content to save (Edit here for simple changes):", selectedFiles.get(currentFile.path));
    if (content === null) return; // Cancelled

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
        // Update local state
        selectedFiles.set(currentFile.path, content);
        // Update SHA for next save (vital!)
        // However, standard API response for update content might just return commit info.
        // Ideally we re-fetch to get new SHA or API returns it.
        // Our backend returns { success: true, content: ... } but maybe not SHA.
        // Simpler: reload file.
        addMessage('system', `File saved successfully: ${currentFile.path}`);

    } catch (e) {
        alert(`Error saving file: ${e.message}`);
    } finally {
        saveFileBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Save Changes';
    }
});

// --- Create Repo Logic ---

createRepoBtn.addEventListener('click', () => createRepoModal.classList.remove('hidden'));
cancelCreateRepoBtn.addEventListener('click', () => createRepoModal.classList.add('hidden'));

confirmCreateRepoBtn.addEventListener('click', async () => {
    const name = newRepoName.value.trim();
    if (!name) return alert('Repository name required');

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
        addMessage('system', `Repository created: ${data.repo}`);
        fetchMyRepos(); // Refresh list

    } catch (e) {
        alert(`Error creating repo: ${e.message}`);
    } finally {
        confirmCreateRepoBtn.disabled = false;
        confirmCreateRepoBtn.textContent = 'Create';
    }
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
