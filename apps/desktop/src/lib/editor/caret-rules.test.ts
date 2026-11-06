// @vitest-environment jsdom
/**
 * The caret rules, construct by construct (R1 to R5: see CLAUDE.md, "Caret
 * rules"). Only what the editor does in JS runs here; native movement (Up and
 * Down, clicks) is checked in a browser.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { createTestEditor, type TestEditor } from './test-harness';

let ed: TestEditor;

beforeAll(async () => {
  ed = await createTestEditor();
});

/** Loads `markdown`, presses each key in turn, and shows the result. */
function after(markdown: string, ...keys: string[]): string {
  ed.load(markdown);
  for (const key of keys) {
    const [name, mod] = key.split('+');
    ed.press(name, { shift: mod === 'shift' });
  }
  return ed.show();
}

/** Loads `markdown`, then sends each `beforeinput` in turn, and shows the result. */
function input(markdown: string, ...types: string[]): string {
  ed.load(markdown);
  for (const type of types) ed.beforeInput(type);
  return ed.show();
}

/** Loads `markdown` and moves the caret to `offset` in its block, as a click would. */
function clicked(markdown: string, offset: number): string {
  ed.load(markdown);
  ed.select(offset);
  return ed.show();
}

describe('R1: Left and Right step one visible place over hidden source', () => {
  it('wikilink', () => {
    expect(after('a|b[[Note]]\n', 'ArrowRight')).toBe('ab|[[Note]]\n');
    expect(after('[[Note]]x|\n', 'ArrowLeft')).toBe('[[Note]]|x\n');
    expect(after('[[No|te]]\n', 'ArrowLeft')).toBe('[[N|ote]]\n');
    expect(after('|[[Note]]\n', 'ArrowRight')).toBe('[|[Note]]\n');
  });

  it('inline math', () => {
    expect(after('a|b$x$\n', 'ArrowRight')).toBe('ab|$x$\n');
    expect(after('$x$b|\n', 'ArrowLeft')).toBe('$x$|b\n');
  });

  it('callout marker', () => {
    expect(after('> [!note] |Title\n', 'ArrowLeft')).toBe('> [!note]| Title\n');
  });

  it('comment', () => {
    expect(after('x %%c%%y|\n', 'ArrowLeft')).toBe('x %%c%%|y\n');
    expect(after('x|y%%c%%\n', 'ArrowRight')).toBe('xy|%%c%%\n');
  });

  it('block id: plain text, left to the browser', () => {
    ed.load('p ^abc|\n');
    expect(ed.press('ArrowLeft')).toBe(false);
  });

  it('highlight edge: no hidden source, left to the browser', () => {
    ed.load('a ==hi==|x\n');
    expect(ed.press('ArrowLeft')).toBe(false);
  });
});

describe('R2: a caret landing in collapsed source moves to its edge', () => {
  it('wikilink, from either side', () => {
    expect(clicked('|see [[Note]] x\n', 5)).toBe('see [[|Note]] x\n');
    expect(clicked('see [[Note]] x|\n', 11)).toBe('see [[Note|]] x\n');
  });

  it('inline math', () => {
    expect(clicked('|a $x$ b\n', 3)).toBe('a $x$| b\n');
    expect(clicked('a $x$ b|\n', 3)).toBe('a |$x$ b\n');
  });

  it('callout marker', () => {
    expect(clicked('> [!note] Title\n> bo|dy\n', 3)).toBe('> |[!note] Title\n> body\n');
  });

  it('comment markers', () => {
    expect(clicked('|x %%c%% y\n', 3)).toBe('x %%|c%% y\n');
    expect(clicked('x %%c%% y|\n', 6)).toBe('x %%c|%% y\n');
  });

  it('block id and highlight: nothing hidden, the caret stays', () => {
    expect(clicked('|p ^abc\n', 4)).toBe('p ^a|bc\n');
    expect(clicked('|a ==hi== x\n', 3)).toBe('a ==h|i== x\n');
  });

  it("a callout's marker shows while the caret is anywhere in its title line", () => {
    ed.load('> [!note] Ti|tle\n> body\n');
    expect(ed.view.dom.querySelector('.callout-marker-hidden')).toBeNull();
    ed.load('> [!note] Title\n> bo|dy\n');
    expect(ed.view.dom.querySelector('.callout-marker-hidden')).not.toBeNull();
  });
});

describe('R3: Backspace and Delete remove one visible character', () => {
  it('wikilink', () => {
    expect(after('[[Note]]|x\n', 'Backspace')).toBe('[[Note]|x\n');
    expect(after('a|[[Note]]\n', 'Delete')).toBe('a|[Note]]\n');
    expect(input('[[Note]]|x\n', 'deleteContentBackward')).toBe('[[Note]|x\n');
  });

  it('inline math', () => {
    expect(after('$x$|b\n', 'Backspace')).toBe('$x|b\n');
    expect(input('a|$x$\n', 'deleteContentForward')).toBe('a|x$\n');
  });

  it('callout marker', () => {
    expect(after('> [!note] |Title\n', 'Backspace')).toBe('> [!note]|Title\n');
  });

  it('comment', () => {
    expect(after('x %%c%%|y\n', 'Backspace')).toBe('x %%c%|y\n');
    expect(after('x|%%c%%\n', 'Delete')).toBe('x|%c%%\n');
  });

  it('block id and highlight: plain text, left to the browser', () => {
    ed.load('p ^abc|\n');
    expect(ed.press('Backspace')).toBe(false);
    ed.load('a ==hi==|x\n');
    expect(ed.press('Backspace')).toBe(false);
  });
});

describe('R4: lists work like Google Docs', () => {
  it('bullet', () => {
    expect(after('* a\n* |b\n', 'Backspace')).toBe('* a\n\n|b\n');
    expect(after('* a\n* |b\n', 'Backspace', 'Backspace')).toBe('* a|b\n');
    expect(after('* a\n* |\n* c\n', 'Enter')).toBe('* a\n\n|\n\n* c\n');
    expect(after('* a|\n* b\n', 'Delete')).toBe('* a|b\n');
    expect(after('* a\n* |b\n', 'Tab')).toBe('* a\n  * |b\n');
    expect(input('* a|\n* b\n', 'deleteContentForward')).toBe('* a|b\n');
  });

  it('nested bullet', () => {
    expect(after('* a\n  * |b\n', 'Backspace')).toBe('* a\n* |b\n');
    expect(after('* a\n  * |\n', 'Enter')).toBe('* a\n* |\n');
    expect(after('* a\n  * |b\n', 'Tab+shift')).toBe('* a\n* |b\n');
    expect(after('* a\n  * b|\n* c\n', 'Delete')).toBe('* a\n  * b|c\n');
    expect(after('* a|\n* b\n  * c\n', 'Delete')).toBe('* a|b\n  * c\n');
    expect(input('* a\n  * |b\n', 'deleteContentBackward')).toBe('* a\n* |b\n');
  });

  it('task', () => {
    expect(after('* [ ] a\n* [ ] |b\n', 'Backspace')).toBe('* [ ] a\n\n|b\n');
    expect(after('* [ ] a\n* [ ] |\n', 'Enter')).toBe('* [ ] a\n\n|\n');
    expect(after('* [ ] a|\n* [x] b\n', 'Delete')).toBe('* [ ] a|b\n');
  });

  it('ordered, renumbered', () => {
    expect(after('1. a\n2. |b\n3. c\n', 'Backspace')).toBe('1. a\n\n|b\n\n2. c\n');
    expect(after('1. a\n2. |b\n3. c\n', 'Backspace', 'Backspace')).toBe('1. a|b\n2. c\n');
    expect(after('1. a|\n2. b\n3. c\n', 'Delete')).toBe('1. a|b\n2. c\n');
    expect(after('1. a\n2. |b\n3. c\n', 'Tab')).toBe('1. a\n   1. |b\n2. c\n');
  });

  it('Delete pulls the next line up across a list edge', () => {
    expect(after('a|\n\n* b\n', 'Delete')).toBe('a|b\n');
    expect(after('* a|\n\nb\n', 'Delete')).toBe('* a|b\n');
  });
});

const CODE = '```\ncode\n```';

describe('R5: next to a block, the first press selects it, the second deletes it', () => {
  it('code block before the caret', () => {
    expect(after(`${CODE}\n\n|b\n`, 'Backspace')).toBe('[code_block]\n\nb\n');
    expect(after(`${CODE}\n\n|b\n`, 'Backspace', 'Backspace')).toBe('|b\n');
    expect(after(`a\n\n${CODE}\n\n|\n`, 'Backspace')).toBe('a\n\n[code_block]\n');
    expect(input(`${CODE}\n\n|b\n`, 'deleteContentBackward')).toBe('[code_block]\n\nb\n');
  });

  it('code block after the caret', () => {
    expect(after(`a|\n\n${CODE}\n`, 'Delete')).toBe('a\n\n[code_block]\n');
    expect(after(`a|\n\n${CODE}\n`, 'Delete', 'Delete')).toBe('a|\n');
    expect(after(`a|\n\n${CODE}\n`, 'ArrowRight')).toBe('a\n\n```\n|code\n```\n');
    expect(after(`${CODE}\n\n|b\n`, 'ArrowLeft')).toBe('```\ncode|\n```\n\nb\n');
  });

  it('inside a code block: Backspace at its start makes paragraphs, one per line', () => {
    expect(after('```\n|code\nmore\n```\n', 'Backspace')).toBe('|code\n\nmore\n');
    expect(after('```\n|\n```\n', 'Backspace')).toBe('|\n');
  });

  it('math block', () => {
    expect(after('$$\nx\n$$\n\n|b\n', 'Backspace')).toBe('[math_block]\n\nb\n');
    expect(after('$$\nx\n$$\n\n|b\n', 'Backspace', 'Backspace')).toBe('|b\n');
    expect(after('a|\n\n$$\nx\n$$\n', 'Delete')).toBe('a\n\n[math_block]\n');
    expect(after('a|\n\n$$\nx\n$$\n', 'Delete', 'Delete')).toBe('a|\n');
    expect(after('a|\n\n$$\nx\n$$\n', 'Delete', 'ArrowRight')).toBe('a\n\n$$\nx\n$$\n\n|\n');
  });

  it('table', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |';
    expect(after(`${table}\n\n|b\n`, 'Backspace')).toBe('[table]\n\nb\n');
    expect(after(`${table}\n\n|b\n`, 'Backspace', 'Backspace')).toBe('|b\n');
    expect(after(`a|\n\n${table}\n`, 'Delete')).toBe('a\n\n[table]\n');
  });

  it('image', () => {
    expect(after('![alt](a.png)\n\n|b\n', 'Backspace')).toBe('[image]\n\nb\n');
    expect(after('![alt](a.png)\n\n|b\n', 'Backspace', 'Backspace')).toBe('|b\n');
    expect(after('![alt](a.png)|\n\nb\n', 'Backspace')).toBe('[image]\n\nb\n');
    expect(after('a|\n\n![alt](a.png)\n', 'Delete')).toBe('a\n\n[image]\n');
    expect(after('a|\n\n![alt](a.png)\n', 'Delete', 'Delete')).toBe('a|\n');
  });

  it('embed', () => {
    expect(after('![[Other]]\n\n|b\n', 'Backspace')).toBe('[wiki_embed]\n\nb\n');
    expect(after('![[Other]]\n\n|b\n', 'Backspace', 'Backspace')).toBe('|b\n');
    expect(after('a|\n\n![[Other]]\n', 'Delete')).toBe('a\n\n[wiki_embed]\n');
  });

  it('front matter', () => {
    const fm = '---\ntitle: x\n---';
    expect(after(`${fm}\n\n|b\n`, 'Backspace')).toBe('[frontmatter]\n\nb\n');
    expect(after(`${fm}\n\n|b\n`, 'Backspace', 'Backspace')).toBe('|b\n');
    expect(after(`${fm}\n\n|b\n`, 'ArrowLeft')).toBe('[frontmatter]\n\nb\n');
    // Nothing can go above front matter.
    expect(after(`${fm}\n\n|b\n`, 'ArrowLeft', 'ArrowLeft')).toBe('[frontmatter]\n\nb\n');
  });

  it('hr', () => {
    expect(after('a\n\n***\n\n|b\n', 'Backspace')).toBe('a\n\n[hr]\n\nb\n');
    expect(after('a\n\n***\n\n|b\n', 'Backspace', 'Backspace')).toBe('a\n\n|b\n');
    expect(after('a|\n\n***\n\nb\n', 'Delete')).toBe('a\n\n[hr]\n\nb\n');
    expect(after('a\n\n***\n\n|b\n', 'ArrowLeft', 'ArrowLeft')).toBe('a|\n\n***\n\nb\n');
  });
});

describe('R5: arrows step out of a block, making a line when there is none', () => {
  it('out of a code block at either end of the note', async () => {
    const { leaveBlock } = await import('./block-edges');
    ed.load('```\nco|de\n```\n');
    expect(ed.run(leaveBlock(0, 1))).toBe(true);
    expect(ed.show()).toBe('```\ncode\n```\n\n|\n');
    ed.load('```\nco|de\n```\n');
    expect(ed.run(leaveBlock(0, -1))).toBe(true);
    expect(ed.show()).toBe('|\n\n```\ncode\n```\n');
  });
});
