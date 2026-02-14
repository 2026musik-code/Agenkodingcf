import json

def main():
    # Define the backend logic with NEW API (Magma)
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
    return { githubToken: '', proxyUrl: '' };
  }
  return await object.json();
}

app.get('/api/config', async (c) => {
  try {
    const config: any = await getConfig(c.env);
    return c.json({
        githubToken: config.githubToken ? '********' : '',
        proxyUrl: config.proxyUrl || ''
    });
  } catch (e) {
    return c.json({ error: 'Failed to fetch config' }, 500);
  }
});

app.post('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    // Only save what's needed. We don't need 'ferdevApiKey' anymore.
    const newConfig = {
        githubToken: body.githubToken,
        proxyUrl: body.proxyUrl
    };
    await c.env.vpsai.put('config.json', JSON.stringify(newConfig));
    return c.json({ success: true, message: 'Configuration saved' });
  } catch (e) {
    return c.json({ error: 'Failed to save config' }, 500);
  }
});

// --- GitHub Integration Endpoints ---

app.post('/api/github/tree', async (c) => {
  try {
    const { owner, repo, branch } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;

    const branchName = branch || 'main';
    let targetBranch = branchName;
    const headers: any = {
      'User-Agent': 'Cloudflare-Worker-Agent',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    if (!branch) {
       const repoInfoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
       if (repoInfoRes.ok) {
           const repoInfo: any = await repoInfoRes.json();
           targetBranch = repoInfo.default_branch;
       }
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
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

    const headers: any = {
      'User-Agent': 'Cloudflare-Worker-Agent',
      'Accept': 'application/vnd.github.v3.raw'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
         return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
    }

    const content = await response.text();
    return c.json({ content });
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

    // Construct Prompt
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

    // Call Magma API - No Key Required
    const encodedPrompt = encodeURIComponent(prompt);
    // Limit prompt length (standard 5000 safety for GET)
    if (encodedPrompt.length > 5000) {
        return c.json({ error: 'Context too large. Please select fewer files.' }, 400);
    }

    let targetUrl = `https://magma-api.biz.id/ai/gpt5?prompt=${encodedPrompt}`;

    // Apply Proxy if configured (Fallback)
    if (proxyUrl && proxyUrl.trim() !== '') {
        targetUrl = proxyUrl.trim() + encodeURIComponent(targetUrl);
    }

    // Standard headers
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
        return c.json({
            error: `AI API Error: ${response.status}`,
            details: data.message || JSON.stringify(data)
        }, response.status);
    }

    // New API format: { "status": true, "result": { "response": "..." } }
    if (data.status === true && data.result && data.result.response) {
        // Normalize response for frontend (frontend expects data.result or data.message)
        // Let's send it back as 'result' so frontend logic 'data.result' picks it up.
        // Or adapt frontend. Let's adapt response here.
        return c.json({ result: data.result.response });
    }
    else if (data.message) {
        // Fallback
        return c.json({ result: data.message });
    }

    return c.json(data); // Raw fallback

  } catch (e: any) {
    return c.json({ error: 'Failed to process AI request', details: e.message }, 500);
  }
});
"""

    # Read the UI files (I need to strip the API Key field from HTML)
    # Since I cannot easily regex replace robustly here, I will construct the HTML string with the field REMOVED.
    # Actually, I'll read the existing file and replace the specific block.

    with open('src/ui.html', 'r') as f:
        html_code = f.read()

    # Remove the API Key input div
    # Look for the label and input and the paragraph
    # <label ...>Ferdev AI API Key</label> ... <p ...>Required ...</p>
    # I'll replace the innerHTML of the settings modal or just hide it via CSS? No, cleaner to remove.
    # I will replace the specific block with empty string.

    # Block to remove:
    # <div>
    #     <label class="block text-sm font-medium text-gray-400 mb-1.5">Ferdev AI API Key</label>
    #     <input type="password" id="apiKeyInput" ...>
    #     <p ...>Required for AI responses.</p>
    # </div>

    # I'll use a simple regex or string replacement if I can match it exactly.
    # To be safe, I'll write the NEW HTML content directly in this script.

    new_html_code = """<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>AI Agent Coding</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
    <style>
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #6b7280; }
        .glass {
            background: rgba(31, 41, 55, 0.7);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        /* Mobile Specifics */
        .mobile-safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
        .mobile-safe-top { padding-top: env(safe-area-inset-top); }

        /* App-like transitions */
        .page-transition { transition: transform 0.3s ease-in-out; }
    </style>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        primary: '#3b82f6',
                        secondary: '#10b981',
                        dark: '#0f172a',
                        darker: '#020617',
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-darker text-gray-200 font-sans h-screen flex flex-col md:flex-row overflow-hidden select-none touch-manipulation">

    <!-- Mobile Header -->
    <header class="md:hidden flex items-center justify-between p-4 glass border-b border-gray-800 z-50 mobile-safe-top">
        <button id="mobileMenuBtn" class="text-gray-300 hover:text-white p-2">
            <i class="fa-solid fa-bars text-xl"></i>
        </button>
        <h1 class="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            AI Agent
        </h1>
        <button id="mobileSettingsBtn" class="text-gray-300 hover:text-white p-2">
            <i class="fa-solid fa-gear text-xl"></i>
        </button>
    </header>

    <!-- Sidebar (Desktop & Mobile Drawer) -->
    <aside id="sidebar" class="fixed inset-y-0 left-0 w-80 bg-dark/95 backdrop-blur-xl border-r border-gray-800 flex flex-col z-40 transform -translate-x-full md:translate-x-0 transition-transform duration-300 md:static md:bg-dark md:glass">

        <!-- Desktop Header -->
        <div class="hidden md:flex p-4 border-b border-gray-800 justify-between items-center">
            <h1 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                <i class="fa-solid fa-robot mr-2"></i>AI Agent
            </h1>
            <button id="desktopSettingsBtn" class="text-gray-400 hover:text-white transition">
                <i class="fa-solid fa-gear"></i>
            </button>
        </div>

        <!-- Mobile Close Button -->
        <div class="md:hidden p-4 flex justify-end mobile-safe-top">
            <button id="closeSidebarBtn" class="text-gray-400 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
            </button>
        </div>

        <!-- Repo Loader -->
        <div class="p-4 space-y-2">
            <label class="text-xs text-gray-500 uppercase font-semibold">Repository</label>
            <div class="flex space-x-2">
                <input type="text" id="repoInput" placeholder="owner/repo" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition">
                <button id="loadRepoBtn" class="bg-primary hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm transition shadow-lg shadow-blue-500/20">
                    <i class="fa-solid fa-download"></i>
                </button>
            </div>
        </div>

        <!-- File Tree -->
        <div class="flex-1 overflow-y-auto p-2 scrollbar-thin" id="fileTree">
            <div class="flex flex-col items-center justify-center h-full text-gray-500 text-sm space-y-2">
                <i class="fa-brands fa-github text-4xl opacity-20"></i>
                <p>Load a repo to start</p>
            </div>
        </div>

        <!-- Context Summary -->
        <div class="p-4 border-t border-gray-800 bg-gray-900/30 text-xs text-gray-400 flex justify-between items-center mobile-safe-bottom">
            <span>Selected: <span id="selectedCount" class="text-white font-bold">0</span></span>
            <button id="clearContextBtn" class="text-red-400 hover:text-red-300 transition px-2 py-1 rounded hover:bg-red-500/10">Clear All</button>
        </div>
    </aside>

    <!-- Overlay for Mobile Sidebar -->
    <div id="sidebarOverlay" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 hidden md:hidden transition-opacity opacity-0"></div>

    <!-- Main Chat Area -->
    <main class="flex-1 flex flex-col relative bg-darker w-full h-full">
        <!-- Chat History -->
        <div id="chatContainer" class="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth pb-24 md:pb-32 mobile-safe-bottom">
            <!-- Welcome Message -->
            <div class="flex items-start space-x-3 md:space-x-4 animate-fade-in-up">
                <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0">
                    <i class="fa-solid fa-robot text-white text-sm md:text-base"></i>
                </div>
                <div class="glass rounded-2xl rounded-tl-none p-3 md:p-4 max-w-[85%] md:max-w-3xl shadow-xl text-sm md:text-base">
                    <p>Hello! I am your AI Coding Agent. <br>Load a GitHub repository to verify code, or ask me anything.</p>
                </div>
            </div>
        </div>

        <!-- Input Area -->
        <div class="absolute bottom-0 w-full p-2 md:p-6 bg-gradient-to-t from-darker via-darker to-transparent mobile-safe-bottom z-20">
            <div class="max-w-4xl mx-auto relative glass rounded-2xl shadow-2xl border border-gray-700/50 backdrop-blur-md">
                <textarea id="promptInput" rows="1" placeholder="Ask AI..." class="w-full bg-transparent border-none text-white p-3 md:p-4 focus:ring-0 resize-none placeholder-gray-500 text-sm md:text-base max-h-32 overflow-y-auto leading-relaxed"></textarea>
                <div class="flex justify-between items-center px-3 pb-2 md:px-4 md:pb-3 border-t border-gray-700/30 pt-2">
                    <div class="text-[10px] md:text-xs text-gray-500 flex items-center">
                        <i class="fa-brands fa-markdown mr-1"></i> <span class="hidden md:inline">Markdown supported</span>
                    </div>
                    <button id="sendBtn" class="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white px-4 py-1.5 md:px-6 md:py-2 rounded-xl font-semibold shadow-lg shadow-blue-500/20 transition transform active:scale-95 flex items-center text-sm md:text-base">
                        <span>Send</span> <i class="fa-solid fa-paper-plane ml-2"></i>
                    </button>
                </div>
            </div>
        </div>
    </main>

    <!-- Settings Modal -->
    <div id="settingsModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] hidden flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl transform transition-all scale-95 opacity-0" id="settingsContent">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-xl font-bold text-white">Settings</h2>
                <button id="closeSettingsBtn" class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800 transition">
                    <i class="fa-solid fa-xmark text-lg"></i>
                </button>
            </div>

            <div class="space-y-5">
                <!-- Removed API Key Input -->
                <div>
                    <label class="block text-sm font-medium text-gray-400 mb-1.5">GitHub Token (Optional)</label>
                    <input type="password" id="githubTokenInput" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="ghp_...">
                    <p class="text-xs text-gray-600 mt-1.5">For private repos & higher limits.</p>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-400 mb-1.5">Custom Proxy URL (Optional)</label>
                    <input type="text" id="proxyUrlInput" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="e.g. https://my-indo-proxy.com/?url=">
                    <p class="text-xs text-gray-600 mt-1.5">Enter a proxy that forwards requests (with ?url=) to access from Indonesia.</p>
                </div>
            </div>

            <div class="mt-8 flex justify-end">
                <button id="saveSettingsBtn" class="w-full md:w-auto bg-primary hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg transition shadow-lg font-medium">
                    Save Configuration
                </button>
            </div>
        </div>
    </div>

    <script src="/ui.js"></script>
</body>
</html>
"""

    with open('src/ui.html', 'w') as f:
        f.write(new_html_code)

    # Read JS logic and remove apiKey handling
    # I'll just write the NEW JS content.

    new_js_code = """// State
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
// const apiKeyInput = document.getElementById('apiKeyInput'); // REMOVED
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
        // if (data.ferdevApiKey) apiKeyInput.value = data.ferdevApiKey; // REMOVED
        if (data.githubToken) githubTokenInput.value = data.githubToken;
        if (data.proxyUrl) proxyUrlInput.value = data.proxyUrl;
    } catch (e) {
        console.error('Failed to load config', e);
    }
}

saveSettingsBtn.addEventListener('click', async () => {
    // const ferdevApiKey = apiKeyInput.value; // REMOVED
    const githubToken = githubTokenInput.value;
    const proxyUrl = proxyUrlInput.value;

    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    saveSettingsBtn.disabled = true;

    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ githubToken, proxyUrl })
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
            else reply = "```json\\n" + JSON.stringify(data, null, 2) + \"\\n```\";

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

    with open('src/ui.js', 'w') as f:
        f.write(new_js_code)

    # Construct the FINAL full content for src/index.ts
    full_content = f"""{backend_code}

// --- Frontend Serving ---

const htmlContent = {json.dumps(new_html_code)};
const jsContent = {json.dumps(new_js_code)};

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, {{ 'Content-Type': 'application/javascript' }}));

export default app;
"""

    with open('src/index.ts', 'w') as f:
        f.write(full_content)

    print("Successfully generated src/index.ts with Magma API and updated UI.")

if __name__ == "__main__":
    main()
