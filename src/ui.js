// State
let selectedFiles = new Map();
let currentRepo = { owner: '', repo: '' };
let currentRepoFiles = [];
let currentFile = { path: '', sha: '' };
let currentSessionId = Date.now().toString();
let chatHistory = [];

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
const aiProviderSelect = document.getElementById('aiProviderSelect');
const geminiKeyGroup = document.getElementById('geminiKeyGroup');
const geminiKeyInput = document.getElementById('geminiKeyInput');
const geminiModelInput = document.getElementById('geminiModelInput');
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
const tabRepoBtn = document.getElementById('tabRepoBtn');
const tabHistoryBtn = document.getElementById('tabHistoryBtn');
const tabRepoContent = document.getElementById('tabRepoContent');
const tabHistoryContent = document.getElementById('tabHistoryContent');
const historyList = document.getElementById('historyList');
const newChatBtn = document.getElementById('newChatBtn');

// Marked Init
const renderer = new marked.Renderer();
renderer.code = function(code, language) {
    const blockId = 'code-' + Math.random().toString(36).substr(2, 9);
    let highlighted = code;
    if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(code, { language: language }).value;
    } else {
        highlighted = hljs.highlightAuto(code).value;
    }
    return `<div class="relative group my-4">
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition duration-200 z-10 flex space-x-2">
                 <button onclick="copyCode('${blockId}')" class="bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded shadow-md border border-gray-600 flex items-center" title="Copy"><i class="fa-regular fa-copy mr-1"></i> Copy</button>
                 <button onclick="saveCodeToRepo('${blockId}')" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-md border border-blue-500 flex items-center" title="Save"><i class="fa-brands fa-github mr-1"></i> Save</button>
            </div>
            <pre><code id="${blockId}" class="hljs language-${language || 'plaintext'} p-4 rounded-lg block overflow-x-auto text-sm bg-[#282c34]">${highlighted}</code></pre>
            <textarea id="${blockId}-raw" class="hidden">${code}</textarea>
        </div>`;
};
marked.use({ renderer });

// Global Helpers
window.copyCode = function(id) {
    const raw = document.getElementById(id + '-raw').value;
    navigator.clipboard.writeText(raw).then(() => addMessage('system', 'Code copied to clipboard!'));
};
window.saveCodeToRepo = async function(id) {
    const raw = document.getElementById(id + '-raw').value;
    const filename = prompt("Enter the path to save this file (e.g., src/index.js):");
    if (!filename) return;
    if (!currentRepo.owner || !currentRepo.repo) { alert("Please select a repository first!"); return; }
    try {
        // Auto-fetch SHA if exists
        let sha = null;
        try {
            const checkRes = await fetch('/api/github/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename }) });
            if (checkRes.ok) sha = (await checkRes.json()).sha;
        } catch (e) {}

        const res = await fetch('/api/github/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename, content: raw, message: `Update ${filename} from AI`, sha: sha })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        addMessage('system', `Successfully saved <b>${filename}</b>`);
        loadRepository(currentRepo.owner, currentRepo.repo);
    } catch (e) { alert(`Error saving file: ${e.message}`); }
};
window.deleteChat = async function(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    try { await fetch(`/api/history/${id}`, { method: 'DELETE' }); loadHistoryList(); if (id === currentSessionId) startNewChat(); } catch (e) { alert('Failed to delete'); }
};
window.loadChatSession = async function(id) {
    chatContainer.innerHTML = ''; chatHistory = []; currentSessionId = id; localStorage.setItem('lastSessionId', id);
    const loader = document.createElement('div'); loader.className = 'text-center text-gray-500 mt-10'; loader.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...'; chatContainer.appendChild(loader);
    try {
        const res = await fetch(`/api/history/${id}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        chatContainer.removeChild(loader);
        if (data.messages) { chatHistory = data.messages; chatHistory.forEach(msg => addMessageToUI(msg.role, msg.content)); }
        if (window.innerWidth < 768) toggleSidebar(false);
    } catch (e) { chatContainer.innerHTML = ''; addMessage('system', `Error: ${e.message}`); }
};

// UI Logic
function toggleSidebar(show) {
    if (show) { sidebar.classList.remove('-translate-x-full'); sidebarOverlay.classList.remove('hidden'); setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10); if (!tabHistoryContent.classList.contains('hidden')) loadHistoryList(); }
    else { sidebar.classList.add('-translate-x-full'); sidebarOverlay.classList.add('opacity-0'); setTimeout(() => sidebarOverlay.classList.add('hidden'), 300); }
}
mobileMenuBtn?.addEventListener('click', () => toggleSidebar(true));
closeSidebarBtn?.addEventListener('click', () => toggleSidebar(false));
sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));

function toggleSettings(show) {
    if (show) { settingsModal.classList.remove('hidden'); setTimeout(() => { settingsContent.classList.remove('scale-95', 'opacity-0'); settingsContent.classList.add('scale-100', 'opacity-100'); }, 10); }
    else { settingsContent.classList.remove('scale-100', 'opacity-100'); settingsContent.classList.add('scale-95', 'opacity-0'); setTimeout(() => settingsModal.classList.add('hidden'), 300); }
}
settingsBtn?.addEventListener('click', () => toggleSettings(true));
desktopSettingsBtn?.addEventListener('click', () => toggleSettings(true));
mobileSettingsBtn?.addEventListener('click', () => toggleSettings(true));
closeSettingsBtn?.addEventListener('click', () => toggleSettings(false));

// Tabs
tabRepoBtn.addEventListener('click', () => { tabRepoBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium'; tabHistoryBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white'; tabRepoContent.classList.remove('hidden'); tabHistoryContent.classList.add('hidden'); });
tabHistoryBtn.addEventListener('click', () => { tabHistoryBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium'; tabRepoBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white'; tabHistoryContent.classList.remove('hidden'); tabRepoContent.classList.add('hidden'); loadHistoryList(); });

// Settings Logic
aiProviderSelect.addEventListener('change', () => { if (aiProviderSelect.value === 'gemini') geminiKeyGroup.classList.remove('hidden'); else geminiKeyGroup.classList.add('hidden'); });
async function loadConfig() {
    try {
        const res = await fetch('/api/config'); const data = await res.json();
        if (data.githubUsername) githubUsernameInput.value = data.githubUsername;
        if (data.githubToken) githubTokenInput.value = data.githubToken;
        if (data.proxyUrl) proxyUrlInput.value = data.proxyUrl;
        if (data.aiProvider) { aiProviderSelect.value = data.aiProvider; if (data.aiProvider === 'gemini') geminiKeyGroup.classList.remove('hidden'); }
        if (data.geminiApiKey) geminiKeyInput.value = data.geminiApiKey;
        if (data.geminiModel) geminiModelInput.value = data.geminiModel;
    } catch (e) { console.error(e); }
}
saveSettingsBtn.addEventListener('click', async () => {
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; saveSettingsBtn.disabled = true;
    try {
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ githubUsername: githubUsernameInput.value, githubToken: githubTokenInput.value, proxyUrl: proxyUrlInput.value, aiProvider: aiProviderSelect.value, geminiApiKey: geminiKeyInput.value, geminiModel: geminiModelInput.value }) });
        toggleSettings(false); addMessage('system', 'Configuration saved.'); if (!modeListBtn.className.includes('text-gray-400')) fetchMyRepos();
    } catch (e) { alert('Failed to save'); } finally { saveSettingsBtn.textContent = 'Save Configuration'; saveSettingsBtn.disabled = false; }
});

// GitHub Logic
modeManualBtn.addEventListener('click', () => { modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition'; modeListBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition'; manualRepoInputGroup.classList.remove('hidden'); repoListGroup.classList.add('hidden'); });
modeListBtn.addEventListener('click', () => { modeListBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition'; modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition'; manualRepoInputGroup.classList.add('hidden'); repoListGroup.classList.remove('hidden'); fetchMyRepos(); });
async function fetchMyRepos() {
    repoSelect.innerHTML = '<option>Loading...</option>';
    try { const res = await fetch('/api/github/list'); if(!res.ok) throw new Error('Failed'); const data = await res.json(); repoSelect.innerHTML = '<option value="">Select...</option>'; data.repos.forEach(r => { const opt = document.createElement('option'); opt.value = r.full_name; opt.textContent = `${r.full_name} ${r.private ? '(🔒)' : ''}`; repoSelect.appendChild(opt); }); }
    catch (e) { repoSelect.innerHTML = `<option>Error: ${e.message}</option>`; }
}
refreshReposBtn.addEventListener('click', fetchMyRepos);
repoSelect.addEventListener('change', () => { if(repoSelect.value) { const [o, r] = repoSelect.value.split('/'); loadRepository(o, r); } });
loadRepoBtn.addEventListener('click', () => { const v = repoInput.value.trim(); if(v) { const [o, r] = v.split('/'); if(o && r) loadRepository(o, r); } });

async function loadRepository(owner, repo) {
    fileTree.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mr-3"></i> Loading...</div>';
    try {
        const res = await fetch('/api/github/tree', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, repo }) });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json(); currentRepo = { owner, repo }; localStorage.setItem('lastRepo', JSON.stringify(currentRepo)); currentRepoFiles = data.tree || []; renderFileTree(data.tree); addMessage('system', `Loaded: ${owner}/${repo}`); if(window.innerWidth<768) toggleSidebar(false);
    } catch (e) { fileTree.innerHTML = `<div class="p-4 text-red-400 text-center text-sm">Error: ${e.message}</div>`; }
}
function renderFileTree(tree) {
    fileTree.innerHTML = ''; if(!tree || tree.length===0) { fileTree.innerHTML = '<div class="text-center text-gray-500 mt-4 text-sm">Empty.</div>'; return; }
    const sorted = tree.sort((a,b) => (a.type===b.type ? a.path.localeCompare(b.path) : (a.type==='tree' ? -1 : 1)));
    const list = document.createElement('ul'); list.className = 'space-y-1 text-sm p-2';
    sorted.forEach(item => {
        const li = document.createElement('li'); li.className = 'cursor-pointer hover:bg-gray-800/50 rounded-lg px-3 py-2 truncate flex items-center select-none active:bg-gray-700';
        li.innerHTML = `${item.type==='tree'?'<i class="fa-regular fa-folder text-blue-400 mr-2.5"></i>':'<i class="fa-regular fa-file text-gray-400 mr-2.5"></i>'}<span class="truncate">${item.path}</span>`;
        if (item.type==='blob') li.addEventListener('click', () => selectFile(item.path, li));
        list.appendChild(li);
    });
    fileTree.appendChild(list);
}
async function selectFile(path, el) {
    fileTree.querySelectorAll('li').forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500')); el.classList.add('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');
    try { const res = await fetch('/api/github/file', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path }) }); if(!res.ok) throw new Error('Failed'); const data = await res.json(); selectedFiles.set(path, data.content); currentFile = { path, sha: data.sha }; updateContextCount(); fileToolbar.classList.remove('hidden'); addMessage('system', `Selected: ${path}`); } catch (e) { alert(e.message); }
}
function updateContextCount() { selectedCount.textContent = selectedFiles.size; }
clearContextBtn.addEventListener('click', () => { selectedFiles.clear(); currentFile = {path:'', sha:''}; fileToolbar.classList.add('hidden'); updateContextCount(); fileTree.querySelectorAll('li').forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500')); });
saveFileBtn.addEventListener('click', async () => {
    if (!currentFile.path) return; const c = prompt("Confirm content:", selectedFiles.get(currentFile.path)); if (c === null) return;
    saveFileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    try { const res = await fetch('/api/github/file', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: currentFile.path, content: c, sha: currentFile.sha, message: `Update ${currentFile.path}` }) }); if(!res.ok) throw new Error((await res.json()).error); const data = await res.json(); selectedFiles.set(currentFile.path, c); addMessage('system', `Saved: ${currentFile.path}`); } catch (e) { alert(e.message); } finally { saveFileBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Save Changes'; }
});
createRepoBtn.addEventListener('click', () => createRepoModal.classList.remove('hidden'));
cancelCreateRepoBtn.addEventListener('click', () => createRepoModal.classList.add('hidden'));
confirmCreateRepoBtn.addEventListener('click', async () => {
    const name = newRepoName.value.trim(); if (!name) return alert('Name required'); confirmCreateRepoBtn.disabled = true; confirmCreateRepoBtn.textContent = 'Creating...';
    try { const res = await fetch('/api/github/create', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, description: newRepoDesc.value, private: newRepoPrivate.checked }) }); if(!res.ok) throw new Error((await res.json()).error); const data = await res.json(); createRepoModal.classList.add('hidden'); addMessage('system', `Created: ${data.repo}`); fetchMyRepos(); } catch (e) { alert(e.message); } finally { confirmCreateRepoBtn.disabled = false; confirmCreateRepoBtn.textContent = 'Create'; }
});

// Chat & Automation
async function autoSaveFiles(content) {
    if (!currentRepo.owner || !currentRepo.repo) return;
    const regex = /^\`\`\`[\w]*\n([\s\S]*?)\`\`\`/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const lines = match[1].split('\n');
        if (lines.length === 0) continue;
        const first = lines[0].trim();

        // Auto-Save
        const saveMatch = first.match(/(?:\/\/|#|<!--)\s*filename:\s*([^\s-]+)(?:\s*-->)?/i);
        if (saveMatch && saveMatch[1]) {
            const filename = saveMatch[1].trim(); const code = lines.slice(1).join('\n');
            addMessage('system', `<i class="fa-solid fa-spinner fa-spin"></i> Saving <b>${filename}</b>...`);
            try {
                let sha = null; try { const r = await fetch('/api/github/file', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename }) }); if(r.ok) sha = (await r.json()).sha; } catch(e){}
                const res = await fetch('/api/github/file', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename, content: code, message: 'Auto-generated', sha }) });
                if(!res.ok) throw new Error((await res.json()).error); addMessage('system', `<i class="fa-solid fa-check text-green-400"></i> Saved <b>${filename}</b>`); loadRepository(currentRepo.owner, currentRepo.repo);
            } catch(e) { addMessage('system', `<span class="text-red-400">Failed to save ${filename}: ${e.message}</span>`); }
        }

        // Auto-Delete
        const delMatch = first.match(/(?:\/\/|#|<!--)\s*delete-file:\s*([^\s-]+)(?:\s*-->)?/i);
        if (delMatch && delMatch[1]) {
            const filename = delMatch[1].trim();
            addMessage('system', `<i class="fa-solid fa-spinner fa-spin"></i> Deleting <b>${filename}</b>...`);
            try {
                const res = await fetch('/api/github/file', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename }) });
                if(!res.ok) throw new Error((await res.json()).error); addMessage('system', `<i class="fa-solid fa-trash text-red-400"></i> Deleted <b>${filename}</b>`); loadRepository(currentRepo.owner, currentRepo.repo);
            } catch(e) { addMessage('system', `<span class="text-red-400">Failed delete ${filename}: ${e.message}</span>`); }
        }
    }
}

// History
async function loadHistoryList() {
    historyList.innerHTML = '<div class="text-gray-500 text-center text-xs mt-4">Loading...</div>';
    try {
        const res = await fetch('/api/history/list');
        const data = await res.json();
        historyList.innerHTML = '';
        if (data.chats.length === 0) { historyList.innerHTML = '<div class="text-gray-600 text-center text-xs mt-4">No history</div>'; return; }
        data.chats.forEach(chat => {
             const div = document.createElement('div');
             div.className = 'group flex items-center justify-between p-2 rounded hover:bg-gray-800 cursor-pointer text-sm text-gray-300 transition';
             div.innerHTML = `<span><i class="fa-regular fa-message mr-2 text-gray-500"></i>${chat.id}</span>
                              <button onclick="deleteChat(event, '${chat.id}')" class="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition px-2"><i class="fa-solid fa-trash"></i></button>`;
             div.addEventListener('click', () => loadChatSession(chat.id));
             historyList.appendChild(div);
        });
    } catch (e) { historyList.innerHTML = `<div class="text-red-400 text-xs">Error: ${e.message}</div>`; }
}
function startNewChat() { chatContainer.innerHTML = ''; chatHistory = []; currentSessionId = Date.now().toString(); localStorage.setItem('lastSessionId', currentSessionId); addMessage('system', 'New chat started.'); if (window.innerWidth < 768) toggleSidebar(false); }
newChatBtn.addEventListener('click', startNewChat);
async function saveCurrentChat() {
    try { await fetch(`/api/history/${currentSessionId}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ messages: chatHistory }) }); } catch (e) {}
}

function addMessage(role, content) {
    chatHistory.push({ role, content }); addMessageToUI(role, content);
    if (role === 'model') autoSaveFiles(content);
    if (role !== 'system') saveCurrentChat();
}
function addMessageToUI(role, content) {
    const div = document.createElement('div');
    if (role === 'user') {
        div.className = 'flex items-end justify-end space-x-2 space-x-reverse mb-4 animate-fade-in-up';
        div.innerHTML = `<div class="bg-blue-600 text-white rounded-2xl rounded-br-none p-3 md:p-4 max-w-[85%] shadow-md">${content}</div><div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-user text-white text-xs"></i></div>`;
    } else if (role === 'system') {
        div.className = 'flex items-start justify-start space-x-3 mb-4 animate-fade-in-up';
        div.innerHTML = `<div class="w-8 h-8 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50 shrink-0"><i class="fa-solid fa-info text-yellow-500 text-xs"></i></div><div class="bg-yellow-900/10 border border-yellow-600/20 text-yellow-200 rounded-2xl p-3 max-w-[85%] text-sm">${content}</div>`;
    } else {
        div.className = 'flex items-start justify-start space-x-3 mb-4 animate-fade-in-up';
        const bubble = document.createElement('div'); bubble.className = 'glass text-gray-100 shadow-xl rounded-tl-none rounded-2xl p-3 md:p-4 max-w-[85%] overflow-x-auto text-sm md:text-base';
        bubble.innerHTML = marked.parse(content); bubble.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
        div.innerHTML = `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-robot text-white text-xs"></i></div>`;
        div.appendChild(bubble);
    }
    chatContainer.appendChild(div); scrollToBottom();
}
function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }
sendBtn.addEventListener('click', sendMessage);
promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
async function sendMessage() {
    const msg = promptInput.value.trim(); if (!msg) return; addMessage('user', msg); promptInput.value = '';
    const loader = document.createElement('div'); loader.id = 'loading-msg'; loader.className = 'flex items-start space-x-3 opacity-70 mb-4 animate-pulse'; loader.innerHTML = `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0"><i class="fa-solid fa-robot text-white text-xs"></i></div><div class="glass rounded-2xl rounded-tl-none p-3 text-sm"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Thinking...</div>`; chatContainer.appendChild(loader); scrollToBottom();
    try {
        const context = Array.from(selectedFiles.entries()).map(([path, content]) => ({ path, content }));
        const res = await fetch('/api/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ message: msg, contextFiles: context, repo: currentRepo, fileTree: currentRepoFiles.map(f=>f.path) }) });
        chatContainer.removeChild(loader);
        const data = await res.json();
        if (!res.ok) addMessage('system', `Error: ${data.error || 'Unknown'}`); else addMessage('model', data.result || "No response");
    } catch (e) { if(document.getElementById('loading-msg')) chatContainer.removeChild(loader); addMessage('system', `Network Error: ${e.message}`); }
}

// Init
(async () => {
    await loadConfig();
    const lastRepo = localStorage.getItem('lastRepo');
    if (lastRepo) { try { const { owner, repo } = JSON.parse(lastRepo); if (owner && repo) { currentRepo = { owner, repo }; repoInput.value = `${owner}/${repo}`; await loadRepository(owner, repo); } } catch (e) {} }
    const lastSessionId = localStorage.getItem('lastSessionId'); if (lastSessionId) { await loadChatSession(lastSessionId); }
})();