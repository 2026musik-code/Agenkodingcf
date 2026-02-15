
def process_content(content):
    # Escape backslashes first to preserve them in the generated string
    content = content.replace('\\', '\\\\')
    # Escape backticks to prevent breaking the template literal
    content = content.replace('`', '\\`')
    # Escape dollar signs to prevent string interpolation
    content = content.replace('$', '\\$')
    return content

def main():
    print("Building src/index.ts...")

    try:
        with open('src/ui.html', 'r', encoding='utf-8') as f:
            html_content = process_content(f.read())

        with open('src/ui.js', 'r', encoding='utf-8') as f:
            js_content = process_content(f.read())

        with open('src/backend_template.ts', 'r', encoding='utf-8') as f:
            template = f.read()

        final_code = template.replace('{{HTML_CONTENT}}', html_content)
        final_code = final_code.replace('{{JS_CONTENT}}', js_content)

        with open('src/index.ts', 'w', encoding='utf-8') as f:
            f.write(final_code)

        print("Successfully generated src/index.ts")

    except Exception as e:
        print(f"Error: {e}")
        exit(1)

if __name__ == "__main__":
    main()
