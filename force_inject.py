import json

def main():
    # Read the core logic from src/index.ts
    with open('src/index.ts', 'r') as f:
        full_content = f.read()

    # Split at the marker
    marker = "// --- Frontend Serving ---"
    if marker in full_content:
        base_logic = full_content.split(marker)[0]
    else:
        # Fallback if marker missing (should not happen if file is intact)
        print("Marker not found, using full file but stripping export default")
        base_logic = full_content.replace('export default app;', '')

    # Read the updated UI files
    with open('src/ui.html', 'r') as f:
        html_code = f.read()

    with open('src/ui.js', 'r') as f:
        js_code = f.read()

    # Construct the new file content
    new_content = f"""{base_logic}
{marker}

const htmlContent = {json.dumps(html_code)};
const jsContent = {json.dumps(js_code)};

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, {{ 'Content-Type': 'application/javascript' }}));

export default app;
"""

    with open('src/index.ts', 'w') as f:
        f.write(new_content)

    print("Successfully forced frontend injection.")

if __name__ == "__main__":
    main()
