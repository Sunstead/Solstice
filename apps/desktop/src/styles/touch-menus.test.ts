import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(path.resolve(__dirname, 'app.css'), 'utf8');

// The menu primitives come from @sunstead/ui with rows sized for a mouse, so
// the app grows them where touch leads.
describe('touch menu rows', () => {
  const rule = app.match(/:root\[data-touch\] :is\(([^)]*)\)\s*\{([^}]*)\}/)!;

  it('has a touch rule for menus', () => {
    expect(rule).toBeTruthy();
  });

  it.each([
    'dropdown-menu-item',
    'dropdown-menu-sub-trigger',
    'dropdown-menu-checkbox-item',
    'dropdown-menu-radio-item',
    'context-menu-item',
    'context-menu-sub-trigger',
    'context-menu-checkbox-item',
    'context-menu-radio-item',
  ])('grows %s', (slot) => {
    expect(rule[1]).toContain(`[data-slot='${slot}']`);
  });

  it('makes a row at least 44pt tall', () => {
    expect(rule[2]).toMatch(/min-height:\s*2\.75rem/);
  });
});
