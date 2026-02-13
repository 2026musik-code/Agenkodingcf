import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  vpsai: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

app.get('/', (c) => c.text('AI Agent Coding Backend is Running!'));

// --- R2 Configuration Endpoints ---

async function getConfig(env: Bindings) {
  const object = await env.vpsai.get('config.json');
  if (object === null) {
    return { ferdevApiKey: '', githubToken: '' };
  }
  return await object.json();
}

app.get('/api/config', async (c) => {
  try {
    const config = await getConfig(c.env);
    return c.json(config);
  } catch (e) {
    return c.json({ error: 'Failed to fetch config' }, 500);
  }
});

app.post('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    await c.env.vpsai.put('config.json', JSON.stringify(body));
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
    const apiKey = config.ferdevApiKey;

    if (!apiKey) {
      return c.json({ error: 'AI API Key not configured. Please go to Settings.' }, 400);
    }

    // Construct Prompt
    let prompt = "You are an expert AI Coding Agent. Analyze the following code context and answer the user's request.\n\n";

    if (contextFiles && Array.isArray(contextFiles)) {
      prompt += "--- CONTEXT FILES ---\n";
      for (const file of contextFiles) {
        prompt += `File: ${file.path}\n`;
        prompt += `Content:\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
      }
      prompt += "--- END CONTEXT ---\n\n";
    }

    prompt += `User Request: ${message}`;

    // Call Ferdev API
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://api.ferdev.my.id/ai/gemini?prompt=${encodedPrompt}&apikey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      return c.json({ error: `AI API Error: ${response.status}` }, response.status);
    }

    const data = await response.json();

    // Check if the response format is as expected.
    // If it's pure text, the previous fetch might fail on .json() if not JSON.
    // The user example showed a JSON error, so it likely returns JSON.
    // If it returns { result: "text" } or just { ... }, I'll pass it through or extract the text.
    // Assuming the API returns something like { result: "markdown text" } or similar.
    // Or maybe it returns raw text if successful?
    // Let's assume standard wrapper. If I look at the error example:
    // { "success": false, "message": "..." }
    // So likely { "success": true, "message": "..." } or similar.

    return c.json(data);

  } catch (e: any) {
    // If json() failed, maybe it's text
    return c.json({ error: 'Failed to process AI request', details: e.message }, 500);
  }
});




// --- Frontend Serving ---

const htmlContent = "<!DOCTYPE html>\n<html lang=\"en\" class=\"dark\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>AI Agent Coding</title>\n    <script src=\"https://cdn.tailwindcss.com\"></script>\n    <link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css\">\n    <link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css\">\n    <script src=\"https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js\"></script>\n    <script src=\"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js\"></script>\n    <style>\n        /* Custom scrollbar */\n        ::-webkit-scrollbar { width: 8px; height: 8px; }\n        ::-webkit-scrollbar-track { background: #1f2937; }\n        ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }\n        ::-webkit-scrollbar-thumb:hover { background: #6b7280; }\n        .glass {\n            background: rgba(31, 41, 55, 0.7);\n            backdrop-filter: blur(10px);\n            -webkit-backdrop-filter: blur(10px);\n            border: 1px solid rgba(255, 255, 255, 0.1);\n        }\n    </style>\n    <script>\n        tailwind.config = {\n            darkMode: 'class',\n            theme: {\n                extend: {\n                    colors: {\n                        primary: '#3b82f6',\n                        secondary: '#10b981',\n                        dark: '#0f172a',\n                        darker: '#020617',\n                    }\n                }\n            }\n        }\n    </script>\n</head>\n<body class=\"bg-darker text-gray-200 font-sans h-screen flex overflow-hidden\">\n\n    <!-- Sidebar -->\n    <aside class=\"w-80 bg-dark border-r border-gray-800 flex flex-col glass z-10\">\n        <div class=\"p-4 border-b border-gray-800 flex justify-between items-center\">\n            <h1 class=\"text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400\">\n                <i class=\"fa-solid fa-robot mr-2\"></i>AI Agent\n            </h1>\n            <button id=\"settingsBtn\" class=\"text-gray-400 hover:text-white transition\">\n                <i class=\"fa-solid fa-gear\"></i>\n            </button>\n        </div>\n\n        <!-- Repo Loader -->\n        <div class=\"p-4 space-y-2\">\n            <label class=\"text-xs text-gray-500 uppercase font-semibold\">Repository</label>\n            <div class=\"flex space-x-2\">\n                <input type=\"text\" id=\"repoInput\" placeholder=\"owner/repo\" class=\"w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary transition\">\n                <button id=\"loadRepoBtn\" class=\"bg-primary hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm transition\">\n                    <i class=\"fa-solid fa-download\"></i>\n                </button>\n            </div>\n        </div>\n\n        <!-- File Tree -->\n        <div class=\"flex-1 overflow-y-auto p-2\" id=\"fileTree\">\n            <div class=\"text-center text-gray-500 text-sm mt-10\">\n                Load a repository to view files.\n            </div>\n        </div>\n\n        <!-- Context Summary -->\n        <div class=\"p-3 border-t border-gray-800 bg-gray-900/50 text-xs text-gray-400 flex justify-between\">\n            <span>Selected Files: <span id=\"selectedCount\" class=\"text-white font-bold\">0</span></span>\n            <button id=\"clearContextBtn\" class=\"hover:text-red-400 transition\">Clear</button>\n        </div>\n    </aside>\n\n    <!-- Main Chat Area -->\n    <main class=\"flex-1 flex flex-col relative\">\n        <!-- Chat History -->\n        <div id=\"chatContainer\" class=\"flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth pb-32\">\n            <!-- Welcome Message -->\n            <div class=\"flex items-start space-x-4\">\n                <div class=\"w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg\">\n                    <i class=\"fa-solid fa-robot text-white\"></i>\n                </div>\n                <div class=\"glass rounded-2xl rounded-tl-none p-4 max-w-3xl shadow-xl\">\n                    <p>Hello! I am your AI Coding Agent. Load a GitHub repository to get started, or ask me anything.</p>\n                </div>\n            </div>\n        </div>\n\n        <!-- Input Area -->\n        <div class=\"absolute bottom-0 w-full p-6 bg-gradient-to-t from-darker to-transparent\">\n            <div class=\"max-w-4xl mx-auto relative glass rounded-xl shadow-2xl border border-gray-700/50\">\n                <textarea id=\"promptInput\" rows=\"3\" placeholder=\"Describe your coding task or ask a question...\" class=\"w-full bg-transparent border-none text-white p-4 focus:ring-0 resize-none placeholder-gray-500\"></textarea>\n                <div class=\"flex justify-between items-center px-4 pb-3 border-t border-gray-700/30 pt-2\">\n                    <div class=\"text-xs text-gray-500\">\n                        <i class=\"fa-brands fa-markdown mr-1\"></i> Markdown supported\n                    </div>\n                    <button id=\"sendBtn\" class=\"bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white px-6 py-2 rounded-lg font-semibold shadow-lg transition transform hover:scale-105 flex items-center\">\n                        <span>Send</span> <i class=\"fa-solid fa-paper-plane ml-2\"></i>\n                    </button>\n                </div>\n            </div>\n        </div>\n    </main>\n\n    <!-- Settings Modal -->\n    <div id=\"settingsModal\" class=\"fixed inset-0 bg-black/80 backdrop-blur-sm z-50 hidden flex items-center justify-center\">\n        <div class=\"bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl transform transition-all scale-95 opacity-0\" id=\"settingsContent\">\n            <div class=\"flex justify-between items-center mb-6\">\n                <h2 class=\"text-xl font-bold text-white\">Settings</h2>\n                <button id=\"closeSettingsBtn\" class=\"text-gray-400 hover:text-white transition\">\n                    <i class=\"fa-solid fa-xmark text-lg\"></i>\n                </button>\n            </div>\n            \n            <div class=\"space-y-4\">\n                <div>\n                    <label class=\"block text-sm font-medium text-gray-400 mb-1\">Ferdev AI API Key</label>\n                    <input type=\"password\" id=\"apiKeyInput\" class=\"w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-primary focus:outline-none transition\">\n                    <p class=\"text-xs text-gray-600 mt-1\">Required for AI functionality.</p>\n                </div>\n                <div>\n                    <label class=\"block text-sm font-medium text-gray-400 mb-1\">GitHub Token (Optional)</label>\n                    <input type=\"password\" id=\"githubTokenInput\" class=\"w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-primary focus:outline-none transition\">\n                    <p class=\"text-xs text-gray-600 mt-1\">Required for private repos or higher rate limits.</p>\n                </div>\n            </div>\n\n            <div class=\"mt-8 flex justify-end\">\n                <button id=\"saveSettingsBtn\" class=\"bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded transition shadow-lg\">\n                    Save Configuration\n                </button>\n            </div>\n        </div>\n    </div>\n\n    <script src=\"/ui.js\"></script>\n</body>\n</html>\n";
const jsContent = "// State\nlet selectedFiles = new Map(); // path -> content\nlet currentRepo = { owner: '', repo: '' };\n\n// DOM Elements\nconst settingsModal = document.getElementById('settingsModal');\nconst settingsContent = document.getElementById('settingsContent');\nconst settingsBtn = document.getElementById('settingsBtn');\nconst closeSettingsBtn = document.getElementById('closeSettingsBtn');\nconst saveSettingsBtn = document.getElementById('saveSettingsBtn');\nconst apiKeyInput = document.getElementById('apiKeyInput');\nconst githubTokenInput = document.getElementById('githubTokenInput');\n\nconst repoInput = document.getElementById('repoInput');\nconst loadRepoBtn = document.getElementById('loadRepoBtn');\nconst fileTree = document.getElementById('fileTree');\nconst selectedCount = document.getElementById('selectedCount');\nconst clearContextBtn = document.getElementById('clearContextBtn');\n\nconst chatContainer = document.getElementById('chatContainer');\nconst promptInput = document.getElementById('promptInput');\nconst sendBtn = document.getElementById('sendBtn');\n\n// Markdown Setup\nmarked.setOptions({\n    highlight: function(code, lang) {\n        const language = highlight.getLanguage(lang) ? lang : 'plaintext';\n        return highlight.highlight(code, { language }).value;\n    },\n    langPrefix: 'hljs language-'\n});\n\n// --- Settings Logic ---\n\nfunction toggleSettings(show) {\n    if (show) {\n        settingsModal.classList.remove('hidden');\n        setTimeout(() => {\n            settingsContent.classList.remove('scale-95', 'opacity-0');\n            settingsContent.classList.add('scale-100', 'opacity-100');\n        }, 10);\n    } else {\n        settingsContent.classList.remove('scale-100', 'opacity-100');\n        settingsContent.classList.add('scale-95', 'opacity-0');\n        setTimeout(() => {\n            settingsModal.classList.add('hidden');\n        }, 300);\n    }\n}\n\nsettingsBtn.addEventListener('click', () => toggleSettings(true));\ncloseSettingsBtn.addEventListener('click', () => toggleSettings(false));\n\nasync function loadConfig() {\n    try {\n        const res = await fetch('/api/config');\n        const data = await res.json();\n        if (data.ferdevApiKey) apiKeyInput.value = data.ferdevApiKey;\n        if (data.githubToken) githubTokenInput.value = data.githubToken;\n    } catch (e) {\n        console.error('Failed to load config', e);\n    }\n}\n\nsaveSettingsBtn.addEventListener('click', async () => {\n    const ferdevApiKey = apiKeyInput.value;\n    const githubToken = githubTokenInput.value;\n    \n    saveSettingsBtn.textContent = 'Saving...';\n    try {\n        await fetch('/api/config', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ ferdevApiKey, githubToken })\n        });\n        toggleSettings(false);\n        addMessage('system', 'Configuration saved successfully.');\n    } catch (e) {\n        alert('Failed to save configuration');\n    } finally {\n        saveSettingsBtn.textContent = 'Save Configuration';\n    }\n});\n\n// --- GitHub Logic ---\n\nloadRepoBtn.addEventListener('click', async () => {\n    const input = repoInput.value.trim();\n    if (!input) return;\n    const [owner, repo] = input.split('/');\n    if (!owner || !repo) {\n        alert('Invalid repository format. Use owner/repo');\n        return;\n    }\n\n    loadRepoBtn.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin\"></i>';\n    fileTree.innerHTML = '<div class=\"text-center text-gray-400 mt-4\">Loading repository tree...</div>';\n\n    try {\n        const res = await fetch('/api/github/tree', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ owner, repo })\n        });\n        \n        if (!res.ok) throw new Error((await res.json()).error);\n        \n        const data = await res.json();\n        currentRepo = { owner, repo };\n        renderFileTree(data.tree);\n        addMessage('system', `Loaded repository: ${owner}/${repo}`);\n    } catch (e) {\n        fileTree.innerHTML = `<div class=\"text-red-400 text-center mt-4\">Error: ${e.message}</div>`;\n    } finally {\n        loadRepoBtn.innerHTML = '<i class=\"fa-solid fa-download\"></i>';\n    }\n});\n\nfunction renderFileTree(tree) {\n    fileTree.innerHTML = '';\n    // Sort: folders first, then files\n    const sorted = tree.sort((a, b) => {\n        if (a.type === b.type) return a.path.localeCompare(b.path);\n        return a.type === 'tree' ? -1 : 1;\n    });\n\n    const list = document.createElement('ul');\n    list.className = 'space-y-1 text-sm';\n    \n    sorted.forEach(item => {\n        const li = document.createElement('li');\n        li.className = 'cursor-pointer hover:bg-gray-800 rounded px-2 py-1 truncate transition flex items-center';\n        \n        const icon = item.type === 'tree' ? '<i class=\"fa-regular fa-folder text-blue-400 mr-2\"></i>' : '<i class=\"fa-regular fa-file text-gray-400 mr-2\"></i>';\n        li.innerHTML = `${icon}<span>${item.path}</span>`;\n        \n        if (item.type === 'blob') { // File\n            li.addEventListener('click', () => toggleFileSelection(item.path, li));\n        }\n        \n        list.appendChild(li);\n    });\n    fileTree.appendChild(list);\n}\n\nasync function toggleFileSelection(path, element) {\n    if (selectedFiles.has(path)) {\n        selectedFiles.delete(path);\n        element.classList.remove('bg-gray-700', 'text-white');\n        element.classList.add('text-gray-200');\n    } else {\n        // Fetch content\n        element.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin text-primary mr-2\"></i>Loading...';\n        try {\n            const res = await fetch('/api/github/file', {\n                method: 'POST',\n                headers: { 'Content-Type': 'application/json' },\n                body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path })\n            });\n            if (!res.ok) throw new Error('Failed to fetch file');\n            const data = await res.json();\n            \n            selectedFiles.set(path, data.content);\n            element.classList.add('bg-gray-700', 'text-white');\n            element.classList.remove('text-gray-200');\n        } catch (e) {\n            alert(e.message);\n        } finally {\n            // Restore icon\n            element.innerHTML = `<i class=\"fa-regular fa-file text-gray-400 mr-2\"></i><span>${path}</span>`;\n        }\n    }\n    updateContextCount();\n}\n\nfunction updateContextCount() {\n    selectedCount.textContent = selectedFiles.size;\n}\n\nclearContextBtn.addEventListener('click', () => {\n    selectedFiles.clear();\n    updateContextCount();\n    // Re-render tree to clear highlights (simplistic approach)\n    // Ideally we iterate DOM, but re-render is fine for now or just reload.\n    // Let's just remove classes from all LIs\n    const lis = fileTree.querySelectorAll('li');\n    lis.forEach(li => li.classList.remove('bg-gray-700', 'text-white'));\n});\n\n\n// --- Chat Logic ---\n\nfunction addMessage(role, content) {\n    const div = document.createElement('div');\n    div.className = 'flex items-start space-x-4 animate-fade-in-up';\n    \n    let icon = '';\n    let bgClass = '';\n    \n    if (role === 'user') {\n        icon = '<div class=\"w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center shadow-lg\"><i class=\"fa-solid fa-user text-white\"></i></div>';\n        bgClass = 'bg-gray-800 text-white border border-gray-700';\n    } else if (role === 'system') {\n         icon = '<div class=\"w-10 h-10 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50\"><i class=\"fa-solid fa-info text-yellow-500\"></i></div>';\n         bgClass = 'bg-yellow-900/10 border border-yellow-600/20 text-yellow-200';\n    } else {\n        icon = '<div class=\"w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg\"><i class=\"fa-solid fa-robot text-white\"></i></div>';\n        bgClass = 'glass text-gray-100 shadow-xl';\n    }\n\n    const bubble = document.createElement('div');\n    bubble.className = `${bgClass} rounded-2xl p-4 max-w-3xl overflow-x-auto`;\n    if (role === 'user') bubble.classList.add('rounded-tr-none');\n    else bubble.classList.add('rounded-tl-none');\n    \n    if (role === 'model' || role === 'system') {\n        bubble.innerHTML = marked.parse(content);\n        // Highlight code blocks\n        bubble.querySelectorAll('pre code').forEach((block) => {\n            highlight.highlightElement(block);\n        });\n    } else {\n        bubble.textContent = content;\n    }\n\n    div.innerHTML = icon;\n    div.appendChild(bubble);\n    \n    chatContainer.appendChild(div);\n    chatContainer.scrollTop = chatContainer.scrollHeight;\n}\n\nsendBtn.addEventListener('click', sendMessage);\npromptInput.addEventListener('keydown', (e) => {\n    if (e.key === 'Enter' && !e.shiftKey) {\n        e.preventDefault();\n        sendMessage();\n    }\n});\n\nasync function sendMessage() {\n    const message = promptInput.value.trim();\n    if (!message) return;\n\n    addMessage('user', message);\n    promptInput.value = '';\n\n    // Create loading message\n    const loadingDiv = document.createElement('div');\n    loadingDiv.id = 'loading-msg';\n    loadingDiv.className = 'flex items-start space-x-4 opacity-50';\n    loadingDiv.innerHTML = `\n        <div class=\"w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center\">\n            <i class=\"fa-solid fa-robot text-white\"></i>\n        </div>\n        <div class=\"glass rounded-2xl rounded-tl-none p-4\">\n            <i class=\"fa-solid fa-circle-notch fa-spin\"></i> Thinking...\n        </div>\n    `;\n    chatContainer.appendChild(loadingDiv);\n    chatContainer.scrollTop = chatContainer.scrollHeight;\n\n    try {\n        const context = Array.from(selectedFiles.entries()).map(([path, content]) => ({ path, content }));\n        \n        const res = await fetch('/api/chat', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ message, contextFiles: context })\n        });\n\n        const data = await res.json();\n        \n        // Remove loading\n        chatContainer.removeChild(loadingDiv);\n\n        if (!res.ok) {\n            addMessage('system', `Error: ${data.error || 'Unknown error'}`);\n        } else {\n            // Handle response format. If it's pure text or JSON with message field.\n            // Adjust based on actual API response.\n            // Assuming \"message\" or direct text if simple.\n            // If the API returns the gemini response structure, it might be nested.\n            // For now, let's dump the whole object if it's not clear, or try to find a text field.\n            \n            let reply = \"No response text found.\";\n            if (typeof data === 'string') reply = data;\n            else if (data.message) reply = data.message;\n            else if (data.result) reply = data.result; // Common wrapper\n            else if (data.candidates && data.candidates[0].content) reply = data.candidates[0].content.parts[0].text; // Google standard\n            else reply = \"```json\\n\" + JSON.stringify(data, null, 2) + \"\\n```\"; // Fallback debug\n\n            addMessage('model', reply);\n        }\n\n    } catch (e) {\n        if (document.getElementById('loading-msg')) chatContainer.removeChild(loadingDiv);\n        addMessage('system', `Network Error: ${e.message}`);\n    }\n}\n\n// Initial Load\nloadConfig();\n";

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, { 'Content-Type': 'application/javascript' }));

export default app;
