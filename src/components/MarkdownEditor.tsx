import { useState } from 'react';
import { FileText, Download, Copy, Eye, Code, Trash2, Wand2 } from 'lucide-react';

export function MarkdownEditor() {
  const [markdown, setMarkdown] = useState(() => {
    const saved = localStorage.getItem('markdown-content');
    return saved || '# Welcome to Markdown Editor\n\nStart typing your markdown here...';
  });
  const [plainText, setPlainText] = useState('');
  const [inputMode, setInputMode] = useState<'markdown' | 'plaintext'>('markdown');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');

  const saveToLocalStorage = (content: string) => {
    setMarkdown(content);
    localStorage.setItem('markdown-content', content);
  };

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `document-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(markdown);
  };

  const clearContent = () => {
    if (confirm('Clear all content?')) {
      if (inputMode === 'markdown') {
        saveToLocalStorage('');
      } else {
        setPlainText('');
      }
    }
  };

  const convertToMarkdown = () => {
    let converted = plainText;

    // Split into lines for processing
    const lines = converted.split('\n');
    const processedLines = lines.map((line, index) => {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) return line;

      // Detect headings (lines that are short and look like titles)
      if (trimmed.length < 60 && /^[A-Z]/.test(trimmed) && !trimmed.endsWith('.')) {
        // Check if previous line was empty (likely a heading)
        if (index === 0 || !lines[index - 1].trim()) {
          return `## ${trimmed}`;
        }
      }

      // Detect list items (lines starting with -, *, or numbers)
      if (/^[-*]\s/.test(trimmed)) {
        return trimmed;
      }
      if (/^\d+\.\s/.test(trimmed)) {
        return trimmed;
      }

      // Auto-link URLs
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      if (urlRegex.test(trimmed)) {
        return trimmed.replace(urlRegex, '[$1]($1)');
      }

      return line;
    });

    converted = processedLines.join('\n');

    // Save as markdown and switch to markdown mode
    saveToLocalStorage(converted);
    setInputMode('markdown');
    setPlainText(''); // Clear plain text buffer
  };

  // Simple markdown to HTML converter (basic implementation)
  const renderMarkdown = (md: string) => {
    // Escape raw HTML first — the result goes into dangerouslySetInnerHTML,
    // so unescaped input (e.g. pasted <img onerror=…>) would execute.
    // Placeholder control chars delimit link tags below; strip them from the input so
    // pasted text cannot forge one.
    let html = md
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0001-\u0003]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Links first, as placeholders: the URL must not run through the bold/italic/code
    // rules below (a '*' or backtick in it would inject markup into the href). Only
    // http(s) targets become links; javascript:, data:, … stay plain text.
    const linkOpenTags: string[] = [];
    html = html.replace(/\[(.*?)\]\((.*?)\)/gim, (match, text: string, href: string) => {
      if (!/^https?:\/\//i.test(href)) return match;
      linkOpenTags.push(
        `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-accent hover:text-accent-bright underline">`
      );
      return `\u0001${linkOpenTags.length - 1}\u0002${text}\u0003`;
    });

    // Headers
    html = html.replace(
      /^### (.*$)/gim,
      '<h3 class="text-lg font-bold text-accent mb-2 mt-4">$1</h3>'
    );
    html = html.replace(
      /^## (.*$)/gim,
      '<h2 class="text-xl font-bold text-accent mb-3 mt-4">$1</h2>'
    );
    html = html.replace(
      /^# (.*$)/gim,
      '<h1 class="text-2xl font-bold text-accent mb-4 mt-4">$1</h1>'
    );

    // Bold
    html = html.replace(
      /\*\*(.*?)\*\*/gim,
      '<strong class="font-bold text-accent-bright">$1</strong>'
    );

    // Italic
    html = html.replace(/\*(.*?)\*/gim, '<em class="italic text-gray-300">$1</em>');

    // Code blocks
    html = html.replace(
      /```([\s\S]*?)```/gim,
      '<pre class="bg-bg border border-line rounded p-3 my-3 overflow-x-auto"><code class="text-sm font-mono text-green-300">$1</code></pre>'
    );

    // Inline code
    html = html.replace(
      /`(.*?)`/gim,
      '<code class="bg-bg px-1 py-0.5 rounded text-sm font-mono text-green-300">$1</code>'
    );

    // Lists
    html = html.replace(/^\* (.*$)/gim, '<li class="ml-4">• $1</li>');
    html = html.replace(/^- (.*$)/gim, '<li class="ml-4">• $1</li>');

    // Restore link tags
    html = html
      // eslint-disable-next-line no-control-regex
      .replace(/\u0001(\d+)\u0002/g, (_m, i: string) => linkOpenTags[Number(i)])
      // eslint-disable-next-line no-control-regex
      .replace(/\u0003/g, '</a>');

    // Line breaks
    html = html.replace(/\n/gim, '<br />');

    return html;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-accent" />
          <h3 className="text-lg font-bold">MARKDOWN EDITOR</h3>
        </div>
        <div className="flex items-center gap-2">
          {/* Input Mode Toggle */}
          <div className="flex gap-1 bg-bg border border-line rounded p-1">
            <button
              onClick={() => setInputMode('markdown')}
              className={`px-2 py-1 rounded text-xs transition-all ${
                inputMode === 'markdown' ? 'bg-accent text-bg' : 'text-gray-400 hover:text-accent'
              }`}
            >
              MD
            </button>
            <button
              onClick={() => setInputMode('plaintext')}
              className={`px-2 py-1 rounded text-xs transition-all ${
                inputMode === 'plaintext' ? 'bg-accent text-bg' : 'text-gray-400 hover:text-accent'
              }`}
            >
              TEXT
            </button>
          </div>
          <div className="w-px h-4 bg-line" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('edit')}
              className={`ds-btn ghost icon ${viewMode === 'edit' ? 'active' : ''}`}
              title="Edit Mode"
            >
              <Code className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`ds-btn ghost icon ${viewMode === 'preview' ? 'active' : ''}`}
              title="Preview Mode"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`ds-btn ghost icon ${viewMode === 'split' ? 'active' : ''}`}
              title="Split Mode"
            >
              <div className="flex gap-0.5">
                <div className="w-1.5 h-4 bg-current" />
                <div className="w-1.5 h-4 bg-current" />
              </div>
            </button>
            <div className="w-px h-4 bg-line mx-1" />
            <button
              onClick={copyToClipboard}
              className="ds-btn ghost icon"
              title="Copy to Clipboard"
            >
              <Copy className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={downloadMarkdown}
              className="ds-btn ghost icon"
              title="Download"
            >
              <Download className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={clearContent}
              className="ds-btn ghost icon"
              title="Clear All"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Convert Button (Plain Text Mode) */}
      {inputMode === 'plaintext' && plainText.trim() && (
        <button
          onClick={convertToMarkdown}
          className="ds-btn primary block mb-3"
        >
          <Wand2 className="w-4 h-4" />
          <span>CONVERT TO MARKDOWN</span>
        </button>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-hidden min-h-0">
        {inputMode === 'plaintext' ? (
          // Plain Text Mode
          <textarea
            value={plainText}
            onChange={e => setPlainText(e.target.value)}
            className="w-full h-full bg-bg border border-line rounded p-4 text-sm focus:border-accent focus:outline-none resize-none"
            placeholder="Enter plain text here, then click 'Convert to Markdown'..."
          />
        ) : (
          // Markdown Mode
          <>
            {viewMode === 'edit' && (
              <textarea
                value={markdown}
                onChange={e => saveToLocalStorage(e.target.value)}
                className="w-full h-full bg-bg border border-line rounded p-4 text-sm font-mono focus:border-accent focus:outline-none resize-none"
                placeholder="Start typing markdown..."
              />
            )}

            {viewMode === 'preview' && (
              <div
                className="w-full h-full bg-bg border border-line rounded p-4 text-sm overflow-auto"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
              />
            )}

            {viewMode === 'split' && (
              <div className="flex flex-col md:flex-row gap-2 h-full">
                <textarea
                  value={markdown}
                  onChange={e => saveToLocalStorage(e.target.value)}
                  className="flex-1 bg-bg border border-line rounded p-4 text-sm font-mono focus:border-accent focus:outline-none resize-none"
                  placeholder="Start typing markdown..."
                />
                <div
                  className="flex-1 bg-bg border border-line rounded p-4 text-sm overflow-auto"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats */}
      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
        <span>{markdown.length} characters</span>
        <span>{markdown.split(/\s+/).filter(w => w).length} words</span>
        <span>{markdown.split('\n').length} lines</span>
      </div>
    </div>
  );
}
