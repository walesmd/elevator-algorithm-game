// editor.js — a lean, offline, zero-dependency code editor behind a swappable
// wrapper. The wrapper (`createEditor`) is the architectural point: it hides the
// implementation so a heavier editor (CodeMirror, Monaco) can drop in later without
// touching main.js — the game keeps the same getValue/setValue contract.
//
// Implementation: the classic "highlight overlay" technique. A real <textarea>
// (native caret, selection, undo/redo, IME, accessibility) renders its text
// transparent; a <pre> behind it shows the same text run through highlight.js. We
// keep their scroll positions in sync and a line-number gutter alongside. No
// contenteditable, no library — robust and tiny.

import { highlightJS } from './highlight.js';

/**
 * @param {HTMLElement} mount - container to fill (its contents are replaced)
 * @param {{value?:string, onChange?:(code:string)=>void, tabSize?:number}} [opts]
 * @returns {{getValue:()=>string, setValue:(v:string)=>void, focus:()=>void, destroy:()=>void}}
 */
export function createEditor(mount, { value = '', onChange, tabSize = 2 } = {}) {
  mount.classList.add('cm');
  mount.replaceChildren();

  const gutter = elem('div', 'cm-gutter');
  const wrap = elem('div', 'cm-wrap');
  const pre = elem('pre', 'cm-highlight');
  const codeEl = elem('code');
  pre.appendChild(codeEl);

  const ta = document.createElement('textarea');
  ta.className = 'cm-input';
  ta.spellcheck = false;
  ta.wrap = 'off';
  ta.autocapitalize = 'off';
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('aria-label', 'Your algorithm. Tab indents; press Escape then Tab to leave the editor.');

  wrap.append(pre, ta);
  mount.append(gutter, wrap);

  function paint() {
    const v = ta.value;
    // Trailing space keeps the last (possibly empty) line tall enough to align.
    codeEl.innerHTML = highlightJS(v) + (v.endsWith('\n') || v === '' ? ' ' : '');
    const lineCount = countLines(v);
    let g = '';
    for (let i = 1; i <= lineCount; i++) g += i + '\n';
    gutter.textContent = g;
    syncScroll();
  }

  function syncScroll() {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }

  function emit() {
    paint();
    if (onChange) onChange(ta.value);
  }

  // Tab inserts indentation — but a code editor that swallows Tab is a keyboard
  // trap (WCAG 2.1.2). Escape "arms" an exit: press Escape, then Tab moves focus
  // out like normal. Any other key resumes indent-on-Tab.
  let escapeArmed = false;
  function onKeyDown(e) {
    if (e.key === 'Escape') { escapeArmed = true; return; }
    if (e.key === 'Tab' && !escapeArmed) {
      e.preventDefault();
      insertText(ta, ' '.repeat(tabSize));
      emit();
      return;
    }
    escapeArmed = false; // a normal key, or Tab-after-Escape (let focus move)
  }

  ta.addEventListener('input', emit);
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', onKeyDown);

  ta.value = value;
  paint();

  return {
    getValue: () => ta.value,
    setValue: (v) => {
      ta.value = v == null ? '' : String(v);
      ta.scrollTop = 0;
      ta.scrollLeft = 0;
      paint();
    },
    focus: () => ta.focus(),
    destroy: () => {
      ta.removeEventListener('input', emit);
      ta.removeEventListener('scroll', syncScroll);
      ta.removeEventListener('keydown', onKeyDown);
      mount.replaceChildren();
      mount.classList.remove('cm');
    },
  };
}

function elem(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function countLines(v) {
  let n = 1;
  for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
  return n;
}

// Insert text at the caret, preserving the native undo stack where possible.
// execCommand is deprecated but is still the only thing that keeps undo intact in a
// textarea; it can also throw in some contexts, so it's guarded. setRangeText is the
// next-best fallback (better than reassigning .value, which wipes undo entirely).
function insertText(ta, text) {
  ta.focus();
  let ok = false;
  try {
    ok = typeof document !== 'undefined' && !!document.execCommand && document.execCommand('insertText', false, text);
  } catch {
    ok = false;
  }
  if (ok) return;
  const { selectionStart: s, selectionEnd: e } = ta;
  if (typeof ta.setRangeText === 'function') {
    ta.setRangeText(text, s, e, 'end');
  } else {
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
  }
}
