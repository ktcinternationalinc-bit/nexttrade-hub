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
//
// v55.44 — DOUBLE-SUBMIT GUARD. Max reported tapping Send 3 times posted
// the same comment 3 times. Two layers of protection:
//   1) `submitting` prop from parent disables the button while the save
//      is in flight. Parent sets it true before await, false in finally.
//   2) Internal `localSubmitting` state guards against the parent forgetting
//      to set the prop. We flip it on first call and reset only when
//      `value` clears (parent successfully cleared the input on save) OR
//      when `submitting` prop transitions back to false.
// Belt + suspenders: even if parent forgets one layer, the other catches it.
// ============================================================
export default function RichCommentComposer({ value, onChange, onSubmit, uploading, onAttach, submitting }) {
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const [showHelp, setShowHelp] = useState(false);
  // v55.44 — internal submit-in-flight flag. Backstops the parent's
  // `submitting` prop in case the parent forgets to set it.
  const [localSubmitting, setLocalSubmitting] = useState(false);

  // The button is disabled if EITHER the parent says we're submitting OR
  // our local guard says so. This combined flag is also used to suppress
  // Ctrl+Enter and the Send onClick.
  const isSubmitting = !!submitting || localSubmitting;

  // Reset local guard when parent clears the value (signals successful save)
  // or when the parent's `submitting` prop transitions back to false.
  useEffect(() => {
    if (value === '' || value == null) {
      if (localSubmitting) setLocalSubmitting(false);
    }
  }, [value, localSubmitting]);
  useEffect(() => {
    if (!submitting && localSubmitting) {
      // Parent finished its work; release our guard too so the user can
      // retry if the save errored and the parent left the value in place.
      setLocalSubmitting(false);
    }
  }, [submitting, localSubmitting]);

  // Wrapped submit that flips the local guard before calling parent's
  // onSubmit, and silently drops re-entry attempts.
  const safeSubmit = () => {
    if (isSubmitting) return; // hard block — first tap wins
    if (!onSubmit) return;
    setLocalSubmitting(true);
    try {
      onSubmit();
    } catch (e) {
      // If onSubmit threw synchronously, release the guard so the user
      // can retry. Async errors are released by the effects above.
      setLocalSubmitting(false);
      throw e;
    }
  };

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

  // Prevent toolbar buttons from stealing focus / collapsing selection
  // when clicked. Without this, "select text → click Bold" would lose the
  // selection at the moment the button receives focus, so execCommand fires
  // against an empty selection.
  const preventFocusSteal = (e) => { e.preventDefault(); };

  const handleInput = () => {
    if (editorRef.current && onChange) onChange(editorRef.current.innerHTML);
  };

  const handleKeyDown = (e) => {
    // Ctrl+Enter / Cmd+Enter → submit (with double-submit guard)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      safeSubmit();
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
        <button type="button" title="Bold (Ctrl+B)" onMouseDown={preventFocusSteal} onClick={() => exec('bold')} className={toolBtn + ' font-extrabold'}>B</button>
        <button type="button" title="Italic (Ctrl+I)" onMouseDown={preventFocusSteal} onClick={() => exec('italic')} className={toolBtn + ' italic'}>I</button>
        <button type="button" title="Underline (Ctrl+U)" onMouseDown={preventFocusSteal} onClick={() => exec('underline')} className={toolBtn + ' underline'}>U</button>
        <span className="w-px h-4 bg-slate-300 mx-1" />
        <button type="button" title="Bullet list" onMouseDown={preventFocusSteal} onClick={() => exec('insertUnorderedList')} className={toolBtn}>• List</button>
        <button type="button" title="Numbered list" onMouseDown={preventFocusSteal} onClick={() => exec('insertOrderedList')} className={toolBtn}>1. List</button>
        <span className="w-px h-4 bg-slate-300 mx-1" />
        <button type="button" title="Clear formatting" onMouseDown={preventFocusSteal} onClick={() => exec('removeFormat')} className={toolBtn + ' text-slate-500'}>⌫ Fmt</button>
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
        <label title="Attach a document, image, or file (max 10MB)" className={'px-3 py-2 rounded-lg text-xs font-bold cursor-pointer transition self-start whitespace-nowrap border ' + (uploading ? 'bg-slate-200 text-slate-400 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100')}>
          {uploading ? '⏳ Uploading…' : '📎 Attach'}
          <input ref={fileRef} type="file" className="hidden" disabled={uploading} onChange={async (e) => {
            const file = e.target.files?.[0];
            if (onAttach) await onAttach(file);
            if (fileRef.current) fileRef.current.value = '';
          }} />
        </label>
        <button
          type="button"
          onClick={safeSubmit}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className={'px-4 py-2 rounded-lg text-xs font-semibold self-start transition ' + (isSubmitting ? 'bg-blue-300 text-white cursor-not-allowed opacity-60' : 'bg-blue-500 text-white hover:bg-blue-600')}
        >
          {isSubmitting ? '⏳ Sending…' : 'Send'}
        </button>
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
