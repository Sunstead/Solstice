/**
 * `$x$` and `$$…$$`, tokenized by hand.
 *
 * `remark-math` is deliberately not used. It registers `$` as an "unsafe"
 * character for the stringifier, which would rewrite every literal dollar sign
 * in every note -- `Costs $5` becomes `Costs \$5` on the next autosave. Base
 * remark never escapes `$` ("Dollar sign and percentage are not used in
 * markdown"), and owning both halves here is what keeps it that way. It is the
 * same reasoning that gives wikilinks their own extension.
 */

export const MATH_INLINE_MDAST_TYPE = 'solsticeInlineMath';
export const MATH_BLOCK_MDAST_TYPE = 'solsticeMathBlock';

const DOLLAR = 36;

type Code = number | null;
type State = (code: Code) => State | undefined;

type Effects = {
  enter: (type: string) => void;
  exit: (type: string) => void;
  consume: (code: Code) => void;
};

/** The slice of micromark's tokenizer context these constructs need. */
type TokenizeContext = { previous: Code };

/** micromark encodes CR/LF/CRLF as -5, -4 and -3. */
const isLineEnding = (code: Code) => code !== null && code < -2 && code > -6;

/** Space, tab, and micromark's virtual space for a partially consumed tab. */
const isSpace = (code: Code) => code === 32 || code === 9 || code === -1 || code === -2;

type Token = { type: string };

type CompileContext = {
  stack: { type: string; value: string }[];
  enter: (node: { type: string; value: string }, token: Token) => void;
  exit: (token: Token) => void;
  sliceSerialize: (token: Token) => string;
};

type RemarkData = {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
  toMarkdownExtensions?: unknown[];
};

const endsLine = (code: Code) => code === null || code < -2;

/**
 * `$$…$$`. Registered before the inline form so the doubled marker always wins.
 *
 * Line endings are allowed inside, which is what lets a displayed formula span
 * several lines. A blank line cannot appear -- that would end the paragraph
 * before this tokenizer ever saw it -- so there is no runaway case.
 */
function tokenizeMathBlock(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  // Display math opens a line. Without this, `see $$x$$ here` would parse as a
  // block in the middle of a sentence, and lifting it out of its paragraph
  // (below) would rewrite the author's line into three of them.
  const atLineStart = this.previous === null || isLineEnding(this.previous);

  let hasValue = false;
  // `mathBlockValue` is entered lazily, only once real content is seen. A
  // token that is entered and then immediately exited with nothing consumed
  // -- which happens whenever `$$` is followed straight by a line ending or
  // by the closing `$$` -- is invalid, and micromark's own tokenizer asserts
  // exactly that (`exit()` requires the token to span at least one
  // character). `$$\ncontent\n$$`, the natural way to write a block formula,
  // hits this on every single use, so the guard is not an edge case here.
  let valueOpen = false;

  return start;

  function start(code: Code) {
    if (!atLineStart) return nok(code);

    effects.enter(MATH_BLOCK_MDAST_TYPE);
    effects.enter('mathBlockMarker');
    effects.consume(code);
    return openingSecond;
  }

  function openingSecond(code: Code) {
    if (code !== DOLLAR) return nok(code);
    effects.consume(code);
    effects.exit('mathBlockMarker');
    return value;
  }

  function value(code: Code) {
    if (code === DOLLAR) {
      if (!hasValue) return nok(code);
      if (valueOpen) {
        effects.exit('mathBlockValue');
        valueOpen = false;
      }
      effects.enter('mathBlockMarker');
      effects.consume(code);
      return closingSecond;
    }
    if (code === null) return nok(code);

    // A line ending has to be its own token even in the middle of a
    // construct: the text tokenizer works in per-line chunks, and swallowing
    // one inside another token leaves those chunks unlinkable.
    if (isLineEnding(code)) {
      if (valueOpen) {
        effects.exit('mathBlockValue');
        valueOpen = false;
      }
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      hasValue = true;
      return value;
    }

    if (!valueOpen) {
      effects.enter('mathBlockValue');
      valueOpen = true;
    }
    hasValue = true;
    effects.consume(code);
    return value;
  }

  function closingSecond(code: Code) {
    if (code !== DOLLAR) return nok(code);
    effects.consume(code);
    effects.exit('mathBlockMarker');
    effects.exit(MATH_BLOCK_MDAST_TYPE);
    return ok;
  }
}

/**
 * `$x$`, on a single line, never empty.
 *
 * Neither marker may sit against whitespace -- `$` immediately followed by a
 * space does not open, and a space immediately before `$` does not close. That
 * single rule is what keeps prose like "$5 to $10" out of the parser, and it
 * is the same convention every other `$`-math implementation settles on.
 */
function tokenizeMathInline(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let hasValue = false;
  let previous: Code = null;
  const afterDollar = this.previous === DOLLAR;

  return start;

  function start(code: Code) {
    // `$$x$$` that did not qualify as display math stays literal text rather
    // than becoming inline math with stray dollars around it.
    if (afterDollar) return nok(code);

    effects.enter(MATH_INLINE_MDAST_TYPE);
    effects.enter('mathInlineMarker');
    effects.consume(code);
    effects.exit('mathInlineMarker');
    effects.enter('mathInlineValue');
    return value;
  }

  function value(code: Code) {
    if (code === DOLLAR) {
      if (!hasValue || isSpace(previous)) return nok(code);
      effects.exit('mathInlineValue');
      effects.enter('mathInlineMarker');
      effects.consume(code);
      effects.exit('mathInlineMarker');
      effects.exit(MATH_INLINE_MDAST_TYPE);
      return ok;
    }
    if (endsLine(code)) return nok(code);
    if (!hasValue && isSpace(code)) return nok(code);

    hasValue = true;
    previous = code;
    effects.consume(code);
    return value;
  }
}

const syntaxExtension = {
  text: {
    [DOLLAR]: [
      { name: MATH_BLOCK_MDAST_TYPE, tokenize: tokenizeMathBlock },
      { name: MATH_INLINE_MDAST_TYPE, tokenize: tokenizeMathInline },
    ],
  },
};

const fromMarkdownExtension = {
  enter: {
    [MATH_INLINE_MDAST_TYPE](this: CompileContext, token: Token) {
      this.enter({ type: MATH_INLINE_MDAST_TYPE, value: '' }, token);
    },
    [MATH_BLOCK_MDAST_TYPE](this: CompileContext, token: Token) {
      this.enter({ type: MATH_BLOCK_MDAST_TYPE, value: '' }, token);
    },
  },
  exit: {
    mathInlineValue(this: CompileContext, token: Token) {
      this.stack[this.stack.length - 1].value = this.sliceSerialize(token);
    },

    [MATH_INLINE_MDAST_TYPE](this: CompileContext, token: Token) {
      this.exit(token);
    },
    [MATH_BLOCK_MDAST_TYPE](this: CompileContext, token: Token) {
      // Taken from the construct as a whole rather than accumulated across
      // value chunks, which line endings would otherwise split apart.
      const raw = this.sliceSerialize(token);
      this.stack[this.stack.length - 1].value = raw.slice(2, -2);
      this.exit(token);
    },
  },
};

const toMarkdownExtension = {
  handlers: {
    [MATH_INLINE_MDAST_TYPE]: (node: { value: string }) => `$${node.value}$`,
    [MATH_BLOCK_MDAST_TYPE]: (node: { value: string }) => `$$${node.value}$$`,
  },
};

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/**
 * Moves display math out of the paragraph it was parsed inside.
 *
 * `$$…$$` is tokenized as a text construct, so micromark always hands it back
 * as phrasing content within a paragraph. Leaving it there forces the
 * ProseMirror node to be inline too, which puts an uneditable, full-width box
 * into an inline formatting context -- and the caret next to it then either
 * jumps as text reflows around it or is drawn at the full height of the
 * formula. Display math is a block, so it is made one here, and the schema can
 * declare it as such.
 */
function liftMathBlocks(tree: MdastNode) {
  const children = tree.children;
  if (!children) return;

  const next: MdastNode[] = [];

  for (const child of children) {
    if (
      child.type === 'paragraph' &&
      child.children?.some((c) => c.type === MATH_BLOCK_MDAST_TYPE)
    ) {
      next.push(...splitAroundMath(child));
      continue;
    }

    next.push(child);
    liftMathBlocks(child);
  }

  tree.children = next;
}

/** `[text, break, math]` -> `[paragraph(text), math]`. */
function splitAroundMath(paragraph: MdastNode): MdastNode[] {
  const result: MdastNode[] = [];
  let run: MdastNode[] = [];

  const isFiller = (node: MdastNode) =>
    node.type === 'break' || (node.type === 'text' && !node.value?.trim());

  const flush = () => {
    // The soft break that separated the text from the formula is now the gap
    // between two blocks; left in place it would serialize as an extra blank
    // line, and the result would not survive a second round trip unchanged.
    let start = 0;
    let end = run.length;
    while (start < end && isFiller(run[start])) start += 1;
    while (end > start && isFiller(run[end - 1])) end -= 1;

    // A soft break is not a node -- it lives inside the neighbouring text
    // node's value -- so the newline that separated the text from the formula
    // has to be trimmed off the ends of the run as well, or it serializes as
    // an extra blank line.
    const kept = run.slice(start, end);
    const trimmed = kept
      .map((node, index) => {
        if (node.type !== 'text' || typeof node.value !== 'string') return node;

        let value = node.value;
        if (index === 0) value = value.replace(/^\s+/, '');
        if (index === kept.length - 1) value = value.replace(/\s+$/, '');

        return value === node.value ? node : { ...node, value };
      })
      .filter((node) => node.type !== 'text' || node.value !== '');

    if (trimmed.length > 0) result.push({ type: 'paragraph', children: trimmed });
    run = [];
  };

  for (const child of paragraph.children ?? []) {
    if (child.type === MATH_BLOCK_MDAST_TYPE) {
      flush();
      result.push(child);
      continue;
    }
    run.push(child);
  }

  flush();
  return result.length > 0 ? result : [paragraph];
}

export function remarkMath(this: { data(): unknown }) {
  const data = this.data() as RemarkData;

  (data.micromarkExtensions ??= []).push(syntaxExtension);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdownExtension);
  (data.toMarkdownExtensions ??= []).push(toMarkdownExtension);

  return (tree: MdastNode) => liftMathBlocks(tree);
}
