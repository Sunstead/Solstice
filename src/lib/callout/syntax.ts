/**
 * `[!type]` and `[!type]-`, as a construct of their own.
 *
 * A callout is otherwise just a blockquote, so it would be tempting to leave
 * the marker as ordinary text -- but remark escapes a `[` that opens phrasing
 * content, and `> [!warning]` would be written back as `> \[!warning]` on the
 * first save, breaking the callout here and in every other editor. Owning the
 * stringify side is the only way to keep the marker verbatim, which is exactly
 * why wikilinks have an extension of their own too.
 */

export const CALLOUT_MDAST_TYPE = 'calloutMarker';

const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const BANG = 33;
const HYPHEN = 45;
const PLUS = 43;

type Code = number | null;
type State = (code: Code) => State | undefined;

type Effects = {
  enter: (type: string) => void;
  exit: (type: string) => void;
  consume: (code: Code) => void;
};

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

/** `A-Z a-z 0-9 _ -`, the characters a callout type may use. */
function isTypeCharacter(code: Code, first: boolean): boolean {
  if (code === null) return false;
  const letter =
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  if (first) return letter;

  return letter || (code >= 48 && code <= 57) || code === 95 || code === HYPHEN;
}

function tokenizeCallout(effects: Effects, ok: State, nok: State): State {
  let length = 0;

  return start;

  function start(code: Code) {
    effects.enter(CALLOUT_MDAST_TYPE);
    effects.consume(code);
    return afterBracket;
  }

  function afterBracket(code: Code) {
    if (code !== BANG) return nok(code);
    effects.consume(code);
    return typeName;
  }

  function typeName(code: Code) {
    if (code === RIGHT_BRACKET) {
      if (length === 0) return nok(code);
      effects.consume(code);
      return afterClose;
    }
    if (!isTypeCharacter(code, length === 0)) return nok(code);

    length += 1;
    effects.consume(code);
    return typeName;
  }

  function afterClose(code: Code) {
    // The fold hint belongs to the marker, so it is never escaped either.
    if (code === HYPHEN || code === PLUS) {
      effects.consume(code);
      effects.exit(CALLOUT_MDAST_TYPE);
      return ok;
    }

    effects.exit(CALLOUT_MDAST_TYPE);
    return ok(code);
  }
}

const syntaxExtension = {
  text: {
    [LEFT_BRACKET]: { name: CALLOUT_MDAST_TYPE, tokenize: tokenizeCallout },
  },
};

const fromMarkdownExtension = {
  enter: {
    [CALLOUT_MDAST_TYPE](this: CompileContext, token: Token) {
      this.enter({ type: CALLOUT_MDAST_TYPE, value: '' }, token);
    },
  },
  exit: {
    [CALLOUT_MDAST_TYPE](this: CompileContext, token: Token) {
      this.stack[this.stack.length - 1].value = this.sliceSerialize(token);
      this.exit(token);
    },
  },
};

const toMarkdownExtension = {
  handlers: {
    // Returned verbatim: a handler's result is not passed through `safe`,
    // which is what keeps the brackets unescaped.
    [CALLOUT_MDAST_TYPE]: (node: { value: string }) => node.value,
  },
};

export function remarkCallout(this: { data(): unknown }) {
  const data = this.data() as RemarkData;

  (data.micromarkExtensions ??= []).push(syntaxExtension);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdownExtension);
  (data.toMarkdownExtensions ??= []).push(toMarkdownExtension);
}
