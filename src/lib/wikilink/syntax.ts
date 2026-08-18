/** mdast node type produced and consumed by this extension. */
export const WIKILINK_MDAST_TYPE = 'wikiLink';

const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;

/*
 * Structural types for the micromark and mdast-util interfaces used below.
 * Their type packages are transitive dependencies of remark rather than direct
 * ones, and this extension only touches a handful of members.
 */
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

// micromark encodes line endings as codes below the horizontal tab (-2), and
// end of file as null.
const endsLine = (code: Code) => code === null || code < -2;

function tokenizeWikilink(effects: Effects, ok: State, nok: State): State {
  let hasTarget = false;

  return start;

  function start(code: Code) {
    effects.enter(WIKILINK_MDAST_TYPE);
    effects.enter('wikiLinkMarker');
    effects.consume(code);
    return openingMarker;
  }

  function openingMarker(code: Code) {
    if (code !== LEFT_BRACKET) return nok(code);
    effects.consume(code);
    effects.exit('wikiLinkMarker');
    effects.enter('wikiLinkTarget');
    return target;
  }

  function target(code: Code) {
    if (code === RIGHT_BRACKET) {
      if (!hasTarget) return nok(code);
      effects.exit('wikiLinkTarget');
      effects.enter('wikiLinkMarker');
      effects.consume(code);
      return closingMarker;
    }
    if (code === LEFT_BRACKET || endsLine(code)) return nok(code);
    hasTarget = true;
    effects.consume(code);
    return target;
  }

  function closingMarker(code: Code) {
    if (code !== RIGHT_BRACKET) return nok(code);
    effects.consume(code);
    effects.exit('wikiLinkMarker');
    effects.exit(WIKILINK_MDAST_TYPE);
    return ok;
  }
}

const syntaxExtension = {
  text: {
    [LEFT_BRACKET]: { name: WIKILINK_MDAST_TYPE, tokenize: tokenizeWikilink },
  },
};

const fromMarkdownExtension = {
  enter: {
    [WIKILINK_MDAST_TYPE](this: CompileContext, token: Token) {
      this.enter({ type: WIKILINK_MDAST_TYPE, value: '' }, token);
    },
  },
  exit: {
    wikiLinkTarget(this: CompileContext, token: Token) {
      this.stack[this.stack.length - 1].value = this.sliceSerialize(token);
    },
    [WIKILINK_MDAST_TYPE](this: CompileContext, token: Token) {
      this.exit(token);
    },
  },
};

const toMarkdownExtension = {
  handlers: {
    [WIKILINK_MDAST_TYPE]: (node: { value: string }) => `[[${node.value}]]`,
  },
};

/**
 * Teaches the shared remark processor to parse and stringify wikilinks. Owning
 * the stringify side is what keeps `[[` out of remark's escaping rules, which
 * would otherwise write `\[\[note]]` to disk.
 */
export function remarkWikilink(this: { data(): unknown }) {
  const data = this.data() as RemarkData;

  (data.micromarkExtensions ??= []).push(syntaxExtension);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdownExtension);
  (data.toMarkdownExtensions ??= []).push(toMarkdownExtension);
}