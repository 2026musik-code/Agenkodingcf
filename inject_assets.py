import json
import re

def main():
    # Read source files
    with open('src/index.ts', 'r') as f:
        ts_code = f.read()

    with open('src/ui.html', 'r') as f:
        html_code = f.read()

    with open('src/ui.js', 'r') as f:
        js_code = f.read()

    # Find the marker for Frontend Serving section
    marker = "// --- Frontend Serving ---"

    if marker in ts_code:
        # Keep everything before the marker
        base_code = ts_code.split(marker)[0]
    else:
        # If marker not found, assume it's clean or append to end (but check for existing exports)
        # Remove export default if it exists to re-add it at the end
        base_code = ts_code.replace('export default app;', '')

    # Construct the new content
    new_code = f"""{base_code}
{marker}

const htmlContent = {json.dumps(html_code)};
const jsContent = {json.dumps(js_code)};

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, {{ 'Content-Type': 'application/javascript' }}));

export default app;
"""

    with open('src/index.ts', 'w') as f:
        f.write(new_code)

    print("Successfully injected frontend assets into src/index.ts (Overwriting previous injection)")

if __name__ == "__main__":
    main()
