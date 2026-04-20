'use client';
import { useEffect, useRef, useState } from 'react';

// ============================================================
// R8: Rich-text comment composer for tickets (and potentially other places).
// Toolbar: Bold / Italic / Underline / Bullet list / Numbered list / line break.
// Submit: Ctrl+Enter (or the Send button). Enter produces a new line (<br>).
// Output: HTML string via onChange. Parent is responsible for sanitizing
// before persisting (we emit HTML via the browser's execCommand, which
// can include tags outside our allow-list).
//
// Keeps the editor DOM as the source of truth during composition — we only
// call onChange on input events to reflect upward. Clearing is driven by
// parent's `value==='' ` → we reset the editor DOM.
// ============================================================
export default function RichCommentComposer({ value, onChange, onSubmit, uploading, onAttach }) {
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const [showHelp, setShowHelp] = useState(false);

  // Keep editor in sync with parent value. Only overwrite when parent clears the value
  // (avoid cursor jumps during normal typing).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if ((value === '' || value == null) && el.innerHTML !== '') {
      el.innerHTML = '';
    }
  }, [value]);

  const exec = (cmd, arg) => {
    // Focus first so the command applies to the editor selection, not the button
    if (editorRef.current) editorRef.current.focus();
    try { document.execCommand(cmd, false, arg || null); } catch (e) { /* legacy API */ }
    // Reflect current HTML upward after formatting
    if (editorRef.current && onChange) onChange(editorRef.current.innerHTML);
  };

  const handleInput = () => {
    if (editorRef.current && onChange) onChange(editorRef.current.innerHTML);
  };

  const handleKeyDown = (e) => {
    // Ctrl+Enter / Cmd+Enter → submit
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (onSubmit) onSubmit();
      return;
    }
    // Plain Enter → inserts a <br> (default contenteditable behavior varies by browser;
    // in Firefox it inserts <div>, in Chrome it inserts <br> in some contexts.)
    // Let browser handle — sanitizer will normalize upstream.
  };

  const handlePaste = (e) => {
    // Paste as plain text to prevent arbitrary HTML (styles, images, tracking pixels) from pasting
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    try {
      document.execCommand('insertText', false, text);
    } catch (err) {
      // Fallback — append raw text node
      if (editorRef.current) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          sel.getRangeAt(0).insertNode(document.createTextNode(text));
          sel.collapseToEnd();
        } else {
          editorRef.current.appendChild(document.createTextNode(text));
        }
      }
    }
    handleInput();
  };

  const toolBtn = 'px-2 py-1 rounded text-xs font-bold border border-slate-200 bg-white hover:bg-slate-100 transition';

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 items-center bg-slate-50 rounded-lg p-1.5 border border-slate-200">
        <button type="button" title="Bold (Ctrl+B)" onClick={() => exec('bold')} className={toolBtn + ' font-extrabold'}>B</button>
        <button type="button" title="Italic (Ctrl+I)" onClick={() => exec('italic')} className={toolBtn + ' italic'}>I</button>
        <button type="button" title="Underline (Ctrl+U)" onClick={() => exec('underline')} className={toolBtn + ' underline'}>U</button>
        <span className="w-px h-4 bg-slate-300 mx-1" />
        <button type="button" title="Bullet list" onClick={() => exec('insertUnorderedList')} className={toolBtn}>• List</button>
        <button type="button" title="Numbered list" onClick={() => exec('insertOrderedList')} className={toolBtn}>1. List</button>
        <span className="w-px h-4 bg-slate-300 mx-1" />
        <button type="button" title="Clear formatting" onClick={() => exec('removeFormat')} className={toolBtn + ' text-slate-500'}>⌫ Fmt</button>
        <span className="flex-1" />
        <button type="button" title="Shortcuts" onClick={() => setShowHelp(!showHelp)} className={toolBtn + ' text-slate-400'}>?</button>
      </div>
      {showHelp && (
        <div className="text-[10px] text-slate-500 bg-slate-50 rounded px-2 py-1 border border-slate-200">
          <b>Shortcuts:</b> Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Enter new line · Ctrl+Enter send
        </div>
      )}

      {/* Editor + send/attach row */}
      <div className="flex gap-2 items-stretch">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          data-placeholder="Add comment... (Ctrl+Enter to send)"
          className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white min-h-[60px] max-h-[200px] overflow-auto outline-none focus:border-blue-400"
          style={{ whiteSpace: 'pre-wrap' }}
        />
        <label className={'px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition self-start ' + (uploading ? 'bg-slate-200 text-slate-400' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
          {uploading ? '⏳' : '📎'}
          <input ref={fileRef} type="file" className="hidden" disabled={uploading} onChange={async (e) => {
            const file = e.target.files?.[0];
            if (onAttach) await onAttach(file);
            if (fileRef.current) fileRef.current.value = '';
          }} />
        </label>
        <button type="button" onClick={onSubmit} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold self-start">Send</button>
      </div>

      {/* Empty-state placeholder — rendered via CSS :empty::before */}
      <style jsx>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        .flex-1 :global(ul) { list-style: disc; padding-left: 1.5em; margin: 0.25em 0; }
        .flex-1 :global(ol) { list-style: decimal; padding-left: 1.5em; margin: 0.25em 0; }
      `}</style>
    </div>
  );
}
