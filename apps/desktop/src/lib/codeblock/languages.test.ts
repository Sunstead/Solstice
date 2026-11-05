import { describe, expect, it } from 'vitest';
import { languageForFile } from './languages';

const name = (path: string, text = '') => languageForFile(path, text)?.name ?? null;

// A code tab's language: by the file's name, else by what's in it.
describe('languageForFile', () => {
  it('goes by extension', () => {
    expect(name('/v/app.py')).toBe('Python');
    expect(name('/v/src/main.RS')).toBe('Rust');
    expect(name('/v/data.json')).toBe('JSON');
    expect(name('/v/my.vault/style.css')).toBe('CSS');
  });

  it('goes by file name', () => {
    expect(name('/v/Dockerfile')).toBe('Dockerfile');
    expect(name('/v/CMakeLists.txt')).toBe('CMake');
    expect(name('/v/Gemfile')).toBe('Ruby');
  });

  it('reads the shebang', () => {
    expect(name('/v/run', '#!/usr/bin/env python3\nprint(1)\n')).toBe('Python');
    expect(name('/v/run', '#!/usr/bin/python\n')).toBe('Python');
    expect(name('/v/run', '#!/usr/bin/env node\n')).toBe('JavaScript');
    expect(name('/v/run', '#!/bin/bash\n')).toBe('Shell');
    expect(name('/v/run', '#!/bin/sh -e\n')).toBe('Shell');
    expect(name('/v/run', '#!/usr/bin/env zsh\n')).toBe('Shell');
    expect(name('/v/run', '#!/usr/bin/env ruby\n')).toBe('Ruby');
    expect(name('/v/run', '#!/usr/bin/perl -w\n')).toBe('Perl');
  });

  it('reads vim and emacs modelines', () => {
    expect(name('/v/build', 'x = 1\n# vim: set ft=python ts=4:\n')).toBe('Python');
    expect(name('/v/build', '# vim: filetype=ruby\n')).toBe('Ruby');
    expect(name('/v/build', '# -*- mode: yaml -*-\nkey: value\n')).toBe('YAML');
    expect(name('/v/build', ';; -*- lua -*-\n')).toBe('Lua');
  });

  it('sniffs XML and JSON', () => {
    expect(name('/v/feed.txt', '<?xml version="1.0"?>\n<rss/>\n')).toBe('XML');
    expect(name('/v/data', '{\n  "a": [1, 2]\n}\n')).toBe('JSON');
    expect(name('/v/list.txt', '[1, 2, 3]')).toBe('JSON');
  });

  it('is plain text otherwise', () => {
    expect(name('/v/notes.txt', 'Just some words.\n')).toBeNull();
    expect(name('/v/Makefile', 'all:\n\tcc main.c\n')).toBeNull();
    expect(name('/v/broken.txt', '{ not json')).toBeNull();
  });

  it('puts the file name before what is in it', () => {
    expect(name('/v/app.py', '#!/usr/bin/env node\n')).toBe('Python');
  });
});
