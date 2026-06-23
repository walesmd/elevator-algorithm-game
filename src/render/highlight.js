// highlight.js — a tiny, dependency-free JavaScript syntax highlighter.
//
// Turns source into HTML where tokens are wrapped in <span class="tok-*">. It backs
// the lean code editor (editor.js): a highlighted <pre> sits behind a transparent
// <textarea>, so the textarea provides native caret/selection/undo while this draws
// the colours. That overlay only lines up if the highlighted HTML reproduces the
// source EXACTLY — same characters, same length. So the one hard invariant here is:
//
//   stripTags(unescape(highlightJS(code))) === code   (round-trip safe)
//
// Every input character is consumed by exactly one branch of the master regex
// (including a catch-all), and each piece is HTML-escaped, so nothing is dropped,
// duplicated, or reordered. There's a test for this in test/phase3.test.js.

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'typeof', 'instanceof', 'of', 'in',
  'this', 'class', 'extends', 'super', 'try', 'catch', 'finally', 'throw', 'delete',
  'void', 'yield', 'await', 'async', 'default', 'export', 'import', 'from', 'with',
]);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

// Groups: 1=comment  2=string/template  3=number  4=identifier  5=any other char.
// The trailing [\s\S] guarantees every character matches something.
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`\\])*`?)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;

export function highlightJS(code) {
  let html = '';
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m[1] != null) html += span('tok-comment', m[1]);
    else if (m[2] != null) html += span('tok-string', m[2]);
    else if (m[3] != null) html += span('tok-number', m[3]);
    else if (m[4] != null) {
      const word = m[4];
      if (KEYWORDS.has(word)) html += span('tok-keyword', word);
      else if (LITERALS.has(word)) html += span('tok-literal', word);
      else html += esc(word);
    } else {
      html += esc(m[5]);
    }
    if (m[0] === '') TOKEN.lastIndex++; // safety: never spin on a zero-width match
  }
  return html;
}

function span(cls, text) {
  return `<span class="${cls}">${esc(text)}</span>`;
}

function esc(s) {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
