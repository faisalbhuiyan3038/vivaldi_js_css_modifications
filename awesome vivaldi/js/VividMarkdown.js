// ==UserScript==
// @name         VividMarkdown
// @description  Shared Markdown-to-HTML renderer with LaTeX, code highlighting,
//               table support, and optional streaming split.
//               Extracted from Diabar.js.
// @version      1.0.0
// @author       PaRr0tBoY
// @website      https://github.com/PaRr0tBoY/Awesome-Vivaldi
// ==/UserScript==

/**
 * Usage:
 *   <script src="VividMarkdown.js"></script>
 *   // window.VividMarkdown is now available
 *
 *   // Basic render
 *   const html = VividMarkdown.render("# Hello **world**");
 *
 *   // With hooks (for AskOnPage citation injection)
 *   const html = VividMarkdown.render(text, {
 *     blockquote: (lines) => '<p class="ai-find-cite">"' + VividMarkdown.escapeHtml(lines[0]) + '"</p>',
 *   });
 *
 *   // Streaming: split into committed + preview parts
 *   const parts = VividMarkdown.splitStable(text);
 *
 *   // Post-render enhancement (adds copy buttons + syntax highlight)
 *   VividMarkdown.enhanceCodeBlocks(container);
 *
 *   // Clean model thinking tags
 *   const clean = VividMarkdown.cleanModelText(text);
 */
(() => {
  'use strict';

  if (window.VividMarkdown) return;

  // ══════════════════════════════════════════════════════════
  //  § 1  Helpers
  // ══════════════════════════════════════════════════════════

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function countIndent(line) {
    const match = String(line || '').match(/^ */);
    return match ? match[0].length : 0;
  }

  function stripIndent(line, indent) {
    return String(line || '').slice(Math.min(countIndent(line), indent));
  }

  function isHrLine(line) {
    return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line || '');
  }

  function isTableSeparator(line) {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?:\s*:?-{3,}:?\s*)?\|?\s*$/.test(line || '');
  }

  function parseTableRow(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  // ══════════════════════════════════════════════════════════
  //  § 2  LaTeX
  // ══════════════════════════════════════════════════════════

  const LATEX_SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
    epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ',
    sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
    phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
    Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '*',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
    approx: '≈', sim: '∼', equiv: '≡',
    infty: '∞', partial: '∂', nabla: '∇',
    forall: '∀', exists: '∃', in: '∈', notin: '∉',
    subset: '⊂', subseteq: '⊆', superset: '⊃', supset: '⊃', supseteq: '⊇',
    cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
    angle: '∠', degree: '°', prime: '′',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
    cdots: '⋯', ldots: '…', dots: '…',
    land: '∧', lor: '∨', neg: '¬',
    top: '⊤', bot: '⊥', perp: '⊥', propto: '∝',
    therefore: '∴', because: '∵',
  };

  const LATEX_OPERATORS = {
    sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot',
    sec: 'sec', csc: 'csc', log: 'log', ln: 'ln',
    exp: 'exp', lim: 'lim', max: 'max', min: 'min',
    sup: 'sup', inf: 'inf', arg: 'arg', det: 'det',
    dim: 'dim', gcd: 'gcd',
  };

  function splitLatexTopLevel(source, separator) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (char === '\\') {
        if (separator === '\\\\' && source[i + 1] === '\\' && depth === 0) {
          parts.push(current);
          current = '';
          i += 1;
          continue;
        }
        current += char + (source[i + 1] || '');
        i += 1;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') depth = Math.max(0, depth - 1);
      if (separator === char && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    parts.push(current);
    return parts;
  }

  function renderLatexMatrix(source, displayMode) {
    const m = String(source || '').match(/\\begin\{(p|b|v|V)?matrix\}([\s\S]*?)\\end\{(?:p|b|v|V)?matrix\}/);
    if (!m) return '';
    const kind = m[1] || '';
    const body = m[2] || '';
    const rows = splitLatexTopLevel(body, '\\\\')
      .map((row) => splitLatexTopLevel(row, '&').map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));
    const fences = { p: ['(', ')'], b: ['[', ']'], v: ['|', '|'], V: ['‖', '‖'] }[kind] || ['', ''];
    const colCount = Math.max(1, ...rows.map((r) => r.length));
    return (
      '<span class="ask-latex-matrix-wrap' + (displayMode ? ' display' : '') + '">' +
      (fences[0] ? '<span class="ask-latex-matrix-fence">' + escapeHtml(fences[0]) + '</span>' : '') +
      '<span class="ask-latex-matrix" style="grid-template-columns:repeat(' + colCount + ', max-content)">' +
      rows.map((row) => (
        '<span class="ask-latex-matrix-row">' +
        row.map((cell) => '<span class="ask-latex-matrix-cell">' + renderLatexToHtml(cell, false) + '</span>').join('') +
        '</span>'
      )).join('') +
      '</span>' +
      (fences[1] ? '<span class="ask-latex-matrix-fence">' + escapeHtml(fences[1]) + '</span>' : '') +
      '</span>'
    );
  }

  function renderLatexToHtml(source, displayMode) {
    const raw = String(source || '').trim();
    if (!raw) return '';
    const matrix = renderLatexMatrix(raw, displayMode);
    if (matrix) return matrix;

    let index = 0;
    const readCommand = () => {
      index += 1;
      const start = index;
      while (index < raw.length && /[A-Za-z]/.test(raw[index])) index += 1;
      if (index === start && index < raw.length) index += 1;
      return raw.slice(start, index);
    };
    const skipWhitespace = () => {
      while (index < raw.length && /\s/.test(raw[index])) index += 1;
    };
    const parseGroup = () => {
      skipWhitespace();
      if (raw[index] !== '{') return parseAtom();
      index += 1;
      const html = parseExpression('}');
      if (raw[index] === '}') index += 1;
      return html;
    };
    const parseOptionalGroup = () => {
      skipWhitespace();
      if (raw[index] !== '[') return '';
      index += 1;
      const start = index;
      let depth = 1;
      while (index < raw.length && depth > 0) {
        if (raw[index] === '\\') { index += 2; continue; }
        if (raw[index] === '[') depth += 1;
        if (raw[index] === ']') depth -= 1;
        if (depth > 0) index += 1;
      }
      const value = raw.slice(start, index);
      if (raw[index] === ']') index += 1;
      return value;
    };
    const parseCommand = (command) => {
      if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
        return '<span class="ask-latex-frac"><span class="ask-latex-num">' + parseGroup() + '</span><span class="ask-latex-den">' + parseGroup() + '</span></span>';
      }
      if (command === 'sqrt') {
        const deg = parseOptionalGroup();
        return '<span class="ask-latex-sqrt">' + (deg ? '<span class="ask-latex-root-index">' + renderLatexToHtml(deg, false) + '</span>' : '') + '<span class="ask-latex-radicand">' + parseGroup() + '</span></span>';
      }
      if (command === 'sum' || command === 'prod' || command === 'int' || command === 'oint') {
        return '<span class="ask-latex-largeop">' + { sum: '∑', prod: '∏', int: '∫', oint: '∮' }[command] + '</span>';
      }
      if (command === 'left' || command === 'right' || command === 'big' || command === 'Big' || command === 'bigl' || command === 'bigr' || command === 'Bigl' || command === 'Bigr') {
        skipWhitespace();
        if (raw[index] === '\\') return escapeHtml(LATEX_SYMBOLS[readCommand()] || '');
        const delim = raw[index] || '';
        index += delim ? 1 : 0;
        return delim === '.' ? '' : '<span class="ask-latex-delim">' + escapeHtml(delim) + '</span>';
      }
      if (command === 'overline' || command === 'bar') return '<span class="ask-latex-overline">' + parseGroup() + '</span>';
      if (command === 'underline') return '<span class="ask-latex-underline">' + parseGroup() + '</span>';
      if (command === 'vec') return '<span class="ask-latex-vector">' + parseGroup() + '</span>';
      if (command === 'text' || command === 'mathrm' || command === 'operatorname') return '<span class="ask-latex-text">' + parseGroup() + '</span>';
      if (command === ',' || command === ';') return '<span class="ask-latex-space"></span>';
      if (command === 'quad') return '<span class="ask-latex-quad"></span>';
      if (command === 'qquad') return '<span class="ask-latex-qquad"></span>';
      if (LATEX_OPERATORS[command]) return '<span class="ask-latex-op">' + escapeHtml(LATEX_OPERATORS[command]) + '</span>';
      if (LATEX_SYMBOLS[command]) return escapeHtml(LATEX_SYMBOLS[command]);
      return '<span class="ask-latex-cmd">' + escapeHtml(command) + '</span>';
    };
    const parseAtom = () => {
      if (index >= raw.length) return '';
      const char = raw[index];
      if (char === '{') return parseGroup();
      if (char === '\\') return parseCommand(readCommand());
      if (char === '}') return '';
      index += 1;
      if (/\s/.test(char)) return '<span class="ask-latex-thinspace"></span>';
      return escapeHtml(char);
    };
    const applyScripts = (base) => {
      let sup = '';
      let sub = '';
      while (raw[index] === '^' || raw[index] === '_') {
        const kind = raw[index];
        index += 1;
        const value = parseGroup();
        if (kind === '^') sup = value; else sub = value;
      }
      if (!sup && !sub) return base;
      return '<span class="ask-latex-scripted"><span class="ask-latex-script-base">' + base + '</span><span class="ask-latex-scripts">' + (sup ? '<sup>' + sup + '</sup>' : '') + (sub ? '<sub>' + sub + '</sub>' : '') + '</span></span>';
    };
    const parseExpression = (stopChar) => {
      let html = '';
      while (index < raw.length && raw[index] !== stopChar) {
        if (raw[index] === '^' || raw[index] === '_') { html += applyScripts(''); continue; }
        html += applyScripts(parseAtom());
      }
      return html;
    };
    return '<span class="ask-latex ask-latex-' + (displayMode ? 'display' : 'inline') + '">' + parseExpression('') + '</span>';
  }

  // ══════════════════════════════════════════════════════════
  //  § 3  Inline Markdown
  // ══════════════════════════════════════════════════════════

  function renderInlineMarkdown(text) {
    const latexPlaceholders = [];
    const stashLatex = (html) => {
      const key = '%%AIP_LATEX_' + latexPlaceholders.length + '%%';
      latexPlaceholders.push(html);
      return key;
    };
    let source = String(text || '');
    source = source.replace(/\\\(([\s\S]+?)\\\)/g, (_, latex) => stashLatex('<span class="ask-latex-inline">' + renderLatexToHtml(latex, false) + '</span>'));
    source = source.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => stashLatex('<span class="ask-latex-block">' + renderLatexToHtml(latex, true) + '</span>'));
    source = source.replace(/\$([^$\n]+)\$/g, (_, latex) => stashLatex('<span class="ask-latex-inline">' + renderLatexToHtml(latex, false) + '</span>'));
    let output = escapeHtml(source);
    output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
    output = output.replace(/\[\[([^\]]+)\]\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">[[$1]]</a>');
    output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    output = output.replace(/(^|[\s(])\*([^*]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
    output = output.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    latexPlaceholders.forEach((html, i) => {
      output = output.replaceAll('%%AIP_LATEX_' + i + '%%', html);
    });
    return output;
  }

  // ══════════════════════════════════════════════════════════
  //  § 4  Code highlighting
  // ══════════════════════════════════════════════════════════

  function highlightCode(code, language) {
    const escaped = escapeHtml(code);
    const lang = String(language || '').toLowerCase();
    if (lang === 'json') {
      return escaped
        .replace(/(&quot;.*?&quot;)(\s*:)/g, '<span class="ask-code-key">$1</span>$2')
        .replace(/:\s*(&quot;.*?&quot;)/g, ': <span class="ask-code-string">$1</span>')
        .replace(/\b(true|false|null)\b/g, '<span class="ask-code-keyword">$1</span>')
        .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="ask-code-number">$1</span>');
    }
    if (/^(js|javascript|ts|typescript)$/.test(lang)) {
      return escaped
        .replace(/\b(const|let|var|function|return|if|else|await|async|import|from|export|class|new|throw|try|catch)\b/g, '<span class="ask-code-keyword">$1</span>')
        .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)/g, '<span class="ask-code-string">$1</span>')
        .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="ask-code-number">$1</span>');
    }
    if (/^(bash|sh|shell|zsh)$/.test(lang)) {
      return escaped
        .replace(/^([$\w./-]+)/gm, '<span class="ask-code-keyword">$1</span>')
        .replace(/(\s--?[\w-]+)/g, '<span class="ask-code-number">$1</span>')
        .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="ask-code-string">$1</span>');
    }
    return escaped;
  }

  // ══════════════════════════════════════════════════════════
  //  § 5  Block-level Markdown parser
  // ══════════════════════════════════════════════════════════

  function parseBlocks(blockLines, baseIndent, hooks) {
    const blocks = [];
    let i = 0;

    function parseList(startIndex) {
      const firstLine = blockLines[startIndex];
      const firstMatch = firstLine.match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
      if (!firstMatch) return null;
      const listIndent = firstMatch[1].length;
      const ordered = /\d+\./.test(firstMatch[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      let idx = startIndex;

      while (idx < blockLines.length) {
        const line = blockLines[idx];
        const match = line.match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
        if (!match || match[1].length !== listIndent || (/\d+\./.test(match[2]) !== ordered)) break;
        const taskMatch = match[3].match(/^\[( |x|X)]\s+(.*)$/);
        const itemLines = [taskMatch ? taskMatch[2] : match[3]];
        idx += 1;
        while (idx < blockLines.length) {
          const nextLine = blockLines[idx];
          if (!nextLine.trim()) { itemLines.push(''); idx += 1; continue; }
          const nextMatch = nextLine.match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
          if (nextMatch && nextMatch[1].length === listIndent && (/\d+\./.test(nextMatch[2]) === ordered)) break;
          if (countIndent(nextLine) <= listIndent && !/^>\s?/.test(nextLine)) break;
          itemLines.push(stripIndent(nextLine, listIndent + 2));
          idx += 1;
        }
        const itemHtml = parseBlocks(itemLines, 0, hooks);
        if (taskMatch) {
          const checked = /[xX]/.test(taskMatch[1]);
          items.push('<li class="ask-task-item"><span class="ask-task-box' + (checked ? ' checked' : '') + '" aria-hidden="true">' + (checked ? '✓' : '') + '</span><span class="ask-task-content">' + itemHtml + '</span></li>');
        } else {
          items.push('<li>' + itemHtml + '</li>');
        }
      }
      return { html: '<' + tag + '>' + items.join('') + '</' + tag + '>', nextIndex: idx };
    }

    while (i < blockLines.length) {
      const originalLine = blockLines[i];
      const line = stripIndent(originalLine, baseIndent);
      if (!line.trim()) { i += 1; continue; }
      if (countIndent(originalLine) < baseIndent) break;

      // Fenced code
      if (/^```/.test(line.trim())) {
        const language = line.trim().slice(3).trim();
        const codeLines = [];
        i += 1;
        while (i < blockLines.length && !/^```/.test(stripIndent(blockLines[i], baseIndent).trim())) {
          codeLines.push(stripIndent(blockLines[i], baseIndent));
          i += 1;
        }
        if (i < blockLines.length) i += 1;
        blocks.push('<pre><code' + (language ? ' data-lang="' + escapeHtml(language) + '"' : '') + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
        continue;
      }

      // LaTeX display block
      if (line.trim() === '$$' || line.trim() === '\\[') {
        const closeMarker = line.trim() === '$$' ? '$$' : '\\]';
        const latexLines = [];
        i += 1;
        while (i < blockLines.length && stripIndent(blockLines[i], baseIndent).trim() !== closeMarker) {
          latexLines.push(stripIndent(blockLines[i], baseIndent));
          i += 1;
        }
        if (i < blockLines.length) i += 1;
        blocks.push('<div class="ask-latex-block">' + renderLatexToHtml(latexLines.join('\n'), true) + '</div>');
        continue;
      }

      // Heading
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        blocks.push('<h' + heading[1].length + '>' + renderInlineMarkdown(heading[2]) + '</h' + heading[1].length + '>');
        i += 1;
        continue;
      }

      // HR
      if (isHrLine(line)) { blocks.push('<hr>'); i += 1; continue; }

      // Table
      if (line.includes('|') && i + 1 < blockLines.length && isTableSeparator(stripIndent(blockLines[i + 1], baseIndent))) {
        const headerCells = parseTableRow(line);
        i += 2;
        const rows = [];
        while (i < blockLines.length) {
          const rowLine = stripIndent(blockLines[i], baseIndent);
          if (!rowLine.trim() || !rowLine.includes('|')) break;
          rows.push(parseTableRow(rowLine));
          i += 1;
        }
        blocks.push('<table><thead><tr>' + headerCells.map((c) => '<th>' + renderInlineMarkdown(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + renderInlineMarkdown(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }

      // Blockquote (hook-able)
      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (i < blockLines.length) {
          const current = stripIndent(blockLines[i], baseIndent);
          if (!/^>\s?/.test(current) && current.trim()) break;
          quoteLines.push(current.replace(/^>\s?/, ''));
          i += 1;
          if (i < blockLines.length && !blockLines[i].trim()) { quoteLines.push(''); i += 1; }
        }
        if (hooks?.blockquote) {
          blocks.push(hooks.blockquote(quoteLines));
        } else {
          blocks.push('<blockquote>' + parseBlocks(quoteLines, 0, hooks) + '</blockquote>');
        }
        continue;
      }

      // List
      const list = parseList(i);
      if (list) { blocks.push(list.html); i = list.nextIndex; continue; }

      // Paragraph
      const paragraph = [];
      while (i < blockLines.length) {
        const cl = stripIndent(blockLines[i], baseIndent);
        if (!cl.trim()) break;
        if (/^(#{1,4})\s+/.test(cl) || /^```/.test(cl.trim()) || isHrLine(cl) || /^>\s?/.test(cl) || cl.match(/^(\s*)([-+*]|\d+\.)\s+/) || (cl.includes('|') && i + 1 < blockLines.length && isTableSeparator(stripIndent(blockLines[i + 1], baseIndent)))) break;
        paragraph.push(cl);
        i += 1;
      }
      blocks.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>');
    }
    return blocks.join('');
  }

  // ── Public render ─────────────────────────────────────────

  /**
   * Convert Markdown text to HTML.
   * @param {string} markdown
   * @param {object} [hooks]
   * @param {function(string[]): string} [hooks.blockquote]
   *   Override blockquote rendering. Receives content lines (without > prefix).
   *   Return HTML string. For AskOnPage citation injection, wrap lines in
   *   <p class="ai-find-cite">"text"</p>.
   * @returns {string}
   */
  function render(markdown, hooks) {
    const source = String(markdown || '').replace(/\r/g, '');
    if (!source.trim()) return '';
    return parseBlocks(source.split('\n'), 0, hooks || null);
  }

  // ══════════════════════════════════════════════════════════
  //  § 6  Code block enhancement (copy buttons + syntax highlight)
  // ══════════════════════════════════════════════════════════

  function enhanceCodeBlocks(container) {
    container.querySelectorAll('pre > code').forEach((codeBlock) => {
      const language = codeBlock.getAttribute('data-lang') || '';
      const rawCode = codeBlock.textContent || '';
      codeBlock.innerHTML = highlightCode(rawCode, language);
      const pre = codeBlock.parentElement;
      if (!pre || pre.querySelector('.ask-code-copy')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-code-copy';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(rawCode);
          btn.textContent = 'Copied';
        } catch (_) {
          const range = document.createRange();
          range.selectNodeContents(codeBlock);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          try { document.execCommand('copy'); btn.textContent = 'Copied'; } catch (_) { btn.textContent = 'Failed'; }
          sel?.removeAllRanges();
        }
        window.setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
      });
      pre.appendChild(btn);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  § 7  Streaming helpers
  // ══════════════════════════════════════════════════════════

  /**
   * Strip model thinking/reasoning tags from text.
   */
  function cleanModelText(text) {
    return String(text || '')
      .replace(/<\s*(?:thought|reasoning|think|thinking)\s*>[\s\S]*?<\s*\/\s*(?:thought|reasoning|think|thinking)\s*>/gi, '')
      .replace(/\r/g, '');
  }

  /**
   * Split partial markdown into { committed, preview } for incremental rendering.
   * @param {string} markdown
   * @param {object} [opts]
   * @param {number} [opts.stableTailCommitChars=180]
   */
  function splitStable(markdown, opts) {
    const stableTailCommitChars = opts?.stableTailCommitChars ?? 180;
    const source = String(markdown || '').replace(/\r/g, '');
    if (!source) return { committed: '', preview: '' };
    let committedEnd = 0;
    let cursor = 0;

    function findParagraphBoundary(start) {
      const idx = source.indexOf('\n\n', start);
      return idx === -1 ? -1 : idx + 2;
    }

    while (cursor < source.length) {
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
      if (cursor >= source.length) break;
      if (source.slice(cursor, cursor + 3) === '```') {
        const fenceClose = source.indexOf('\n```', cursor + 3);
        if (fenceClose === -1) break;
        let next = fenceClose + 4;
        if (source[next] === '\n') next += 1;
        committedEnd = next;
        cursor = next;
        continue;
      }
      const lineEnd = source.indexOf('\n', cursor);
      const firstLine = source.slice(cursor, lineEnd === -1 ? source.length : lineEnd);
      const trimmed = firstLine.trim();
      if (/^(#{1,4})\s+/.test(trimmed) || /^>\s?/.test(trimmed) || /^(\s*)([-+*]|\d+\.)\s+/.test(firstLine) || (trimmed.includes('|') && lineEnd !== -1)) break;
      const boundary = findParagraphBoundary(cursor);
      if (boundary === -1) break;
      committedEnd = boundary;
      cursor = boundary;
    }

    let committed = source.slice(0, committedEnd);
    let preview = source.slice(committedEnd);
    const previewTrimmed = preview.trimStart();
    const hasComplex = /(^|\n)(#{1,4}\s|>\s|[-*+]\s|\d+\.\s|\|)|```/.test(previewTrimmed);
    if (!hasComplex && preview.length >= stableTailCommitChars) {
      const sentences = Array.from(preview.matchAll(/[\s\S]*?[。！？.!?](?=\s|$)/g));
      const last = sentences.length ? sentences[sentences.length - 1][0] : '';
      if (last && last.length >= 60) {
        committed += last;
        preview = preview.slice(last.length);
      } else {
        const breakIdx = Math.max(preview.lastIndexOf('\n'), preview.lastIndexOf('  '));
        if (breakIdx >= 80) {
          committed += preview.slice(0, breakIdx + 1);
          preview = preview.slice(breakIdx + 1);
        }
      }
    }
    return { committed, preview };
  }

  // ── Public API ─────────────────────────────────────────────

  window.VividMarkdown = Object.freeze({
    // Core
    escapeHtml,
    render,
    // Post-render
    enhanceCodeBlocks,
    highlightCode,
    // Streaming
    cleanModelText,
    splitStable,
    // Low-level (for consumers that need fine control)
    renderInlineMarkdown,
    renderLatexToHtml,
    LATEX_SYMBOLS,
    LATEX_OPERATORS,
  });
})();
