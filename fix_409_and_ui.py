import json

def main():
    # Define the backend logic with 409 FIX
    backend_code = """import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  vpsai: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// --- R2 Configuration Endpoints ---

async function getConfig(env: Bindings) {
  const object = await env.vpsai.get('config.json');
  if (object === null) {
    return { githubToken: '', githubUsername: '', proxyUrl: '' };
  }
  return await object.json();
}

app.get('/api/config', async (c) => {
  try {
    const config: any = await getConfig(c.env);
    return c.json({
        githubToken: config.githubToken ? '********' : '',
        githubUsername: config.githubUsername || '',
        proxyUrl: config.proxyUrl || ''
    });
  } catch (e) {
    return c.json({ error: 'Failed to fetch config' }, 500);
  }
});

app.post('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    const newConfig = {
        githubToken: body.githubToken,
        githubUsername: body.githubUsername,
        proxyUrl: body.proxyUrl
    };
    await c.env.vpsai.put('config.json', JSON.stringify(newConfig));
    return c.json({ success: true, message: 'Configuration saved' });
  } catch (e) {
    return c.json({ error: 'Failed to save config' }, 500);
  }
});

// --- GitHub Integration Endpoints ---

const getGithubHeaders = (token: string) => ({
    'User-Agent': 'Cloudflare-Worker-Agent',
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`
});

app.get('/api/github/list', async (c) => {
    try {
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/user/repos?sort=updated&per_page=100`;
        const response = await fetch(url, { headers: getGithubHeaders(token) });

        if (!response.ok) {
            return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
        }

        const data: any = await response.json();
        const repos = data.map((r: any) => ({
            full_name: r.full_name,
            private: r.private,
            updated_at: r.updated_at
        }));
        return c.json({ repos });
    } catch (e: any) {
        return c.json({ error: 'Failed to fetch repo list', details: e.message }, 500);
    }
});

app.post('/api/github/create', async (c) => {
    try {
        const { name, private: isPrivate, description } = await c.req.json();
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/user/repos`;
        const response = await fetch(url, {
            method: 'POST',
            headers: getGithubHeaders(token),
            body: JSON.stringify({
                name,
                private: isPrivate,
                description,
                auto_init: true
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
        }

        const data: any = await response.json();
        return c.json({ success: true, repo: data.full_name });
    } catch (e: any) {
        return c.json({ error: 'Failed to create repo', details: e.message }, 500);
    }
});

app.put('/api/github/file', async (c) => {
    try {
        const { owner, repo, path, content, message, sha } = await c.req.json();
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const body: any = {
            message: message || `Update ${path}`,
            content: btoa(content),
        };
        if (sha) body.sha = sha;

        const response = await fetch(url, {
            method: 'PUT',
            headers: getGithubHeaders(token),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
        }

        const data = await response.json();
        return c.json({ success: true, content: data.content });
    } catch (e: any) {
        return c.json({ error: 'Failed to save file', details: e.message }, 500);
    }
});

// Get Tree (Modified to handle empty repos)
app.post('/api/github/tree', async (c) => {
  try {
    const { owner, repo, branch } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;

    let targetBranch = branch;
    const headers = token ? getGithubHeaders(token) : { 'User-Agent': 'Cloudflare-Worker' };

    if (!targetBranch) {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        if (repoRes.ok) {
            const r: any = await repoRes.json();
            targetBranch = r.default_branch;
        } else {
            targetBranch = 'main';
        }
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
        // FIX: Handle 409 (Conflict) which often means the repo is empty or branch missing
        if (response.status === 409 || response.status === 404) {
             // Return empty tree for empty repos so user can create files
             return c.json({ tree: [] });
        }
        const errText = await response.text();
        return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
    }

    const data = await response.json();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch GitHub tree', details: e.message }, 500);
  }
});

app.post('/api/github/file', async (c) => {
  try {
    const { owner, repo, path } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;
    const headers: any = token ? getGithubHeaders(token) : { 'User-Agent': 'Cloudflare-Worker' };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
         return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
    }

    const data: any = await response.json();
    let content = "";
    if (data.encoding === 'base64' && data.content) {
        content = atob(data.content.replace(/\\n/g, ''));
    } else {
        content = "Binary or large file content not displayed.";
    }

    return c.json({ content, sha: data.sha });
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch file content', details: e.message }, 500);
  }
});

// --- AI Chat Endpoint ---

app.post('/api/chat', async (c) => {
  try {
    const { message, contextFiles } = await c.req.json();
    const config: any = await getConfig(c.env);
    const proxyUrl = config.proxyUrl;

    let prompt = "You are an expert AI Coding Agent. Analyze the following code context and answer the user's request.\\n\\n";

    if (contextFiles && Array.isArray(contextFiles)) {
      prompt += "--- CONTEXT FILES ---\\n";
      for (const file of contextFiles) {
        prompt += `File: ${file.path}\\n`;
        prompt += `Content:\\n\`\`\`\\n${file.content}\\n\`\`\`\\n\\n`;
      }
      prompt += "--- END CONTEXT ---\\n\\n";
    }

    prompt += `User Request: ${message}`;

    const encodedPrompt = encodeURIComponent(prompt);
    if (encodedPrompt.length > 5000) {
        return c.json({ error: 'Context too large. Please select fewer files.' }, 400);
    }

    let targetUrl = `https://magma-api.biz.id/ai/gpt5?prompt=${encodedPrompt}`;

    if (proxyUrl && proxyUrl.trim() !== '') {
        targetUrl = proxyUrl.trim() + encodeURIComponent(targetUrl);
    }

    const headers: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://google.com'
    };

    const response = await fetch(targetUrl, { headers });
    const responseText = await response.text();

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        data = { message: responseText };
    }

    if (!response.ok) {
        return c.json({ error: `AI API Error: ${response.status}`, details: data }, response.status);
    }

    if (data.status === true && data.result && data.result.response) {
        return c.json({ result: data.result.response });
    }
    return c.json({ result: data.message || JSON.stringify(data) });

  } catch (e: any) {
    return c.json({ error: 'Failed to process AI request', details: e.message }, 500);
  }
});
"""

    # Update JS logic for Chat UI (Alignment)
    # I need to read the previous JS but I'll overwrite with the new function
    # Instead of reading, I will provide the FULL updated JS content.

    new_js_code = """// State
let selectedFiles = new Map();
let currentRepo = { owner: '', repo: '' };
let currentFile = { path: '', sha: '' };

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

marked.setOptions({
    highlight: function(code, lang) {
        const language = highlight.getLanguage(lang) ? lang : 'plaintext';
        return highlight.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
});

// --- Mobile Sidebar ---
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
            highlight.highlightElement(block);
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
"""

    # We need to save the JS code to src/ui.js for consistency
    with open('src/ui.js', 'w') as f:
        f.write(new_js_code)

    # Finally, read HTML back (it was written earlier) and Assemble
    with open('src/ui.html', 'r') as f:
        html_code = f.read()

    full_content = f"""{backend_code}

// --- Frontend Serving ---

const htmlContent = {json.dumps(html_code)};
const jsContent = {json.dumps(new_js_code)};

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, {{ 'Content-Type': 'application/javascript' }}));

export default app;
"""

    with open('src/index.ts', 'w') as f:
        f.write(full_content)

    print("Successfully assembled src/index.ts with 409 fix and Chat UI improvements.")

if __name__ == "__main__":
    main()
