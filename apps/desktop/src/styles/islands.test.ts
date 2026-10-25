import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, 'islands.css'), 'utf8');
const app = readFileSync(path.resolve(__dirname, 'app.css'), 'utf8');
const shell = readFileSync(path.resolve(__dirname, '../components/app-shell.tsx'), 'utf8');
const sidebar = readFileSync(path.resolve(__dirname, '../components/app-sidebar.tsx'), 'utf8');
const flexlayout = readFileSync(path.resolve(__dirname, 'flexlayout.css'), 'utf8');
const controls = readFileSync(path.resolve(__dirname, '../components/header-controls.tsx'), 'utf8');
const surfaces = readFileSync(path.resolve(__dirname, '../lib/native-surfaces.ts'), 'utf8');

// flexlayout sizes its splitters from --splitter-size, so the gap between
// editor islands is the splitter: dragging it works as it always did.
describe('islands.css', () => {
  it('is loaded, and only under the setting', () => {
    expect(app).toContain("@import './islands.css';");
    expect(app).toMatch(/@custom-variant islands \(&:where\(\[data-islands='true'\]:not\(\[data-phone-layout\]\) \*\)\);/);
    const selectors = [...css.matchAll(/^([^@/\s*}][^{]*)\{/gm)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(',')) expect(part.trim(), part).toMatch(/^:root\[data-islands='true'\]:not\(\[data-phone-layout\]\)/);
    }
  });

  it('parts editor panes by the gap, through the splitter', () => {
    expect(css).toMatch(/--splitter-size:\s*var\(--island-gap\)/);
    expect(css).toMatch(/--color-splitter:\s*transparent/);
  });

  // The tabs share the title bar's row, on the window's colour, so the
  // explorer and the panes below start at one height and end at another.
  it('leaves the tabs on the window, level with the title bar', () => {
    expect(css).not.toMatch(/--color-tabset-background/);
    expect(shell).toMatch(/islands:p-\(--island-gap\) islands:pt-0/);
  });

  it('ends the explorer one gap above the window, as the panes do', () => {
    // Full height plus a margin would run the margin off the window.
    expect(sidebar).toMatch(/islands:h-auto islands:mb-\(--island-gap\)/);
  });

  // Collapsed, the rail's margin is the gap: the panes start at the
  // explorer's left edge, not a gap past it.
  it('starts the panes where the explorer starts when the sidebar collapses', () => {
    expect(shell).toMatch(/state === 'collapsed' && 'islands:pl-0'/);
  });

  // A hovered gap shows a thin line, not the whole gap lit like a scrollbar.
  it('centres the sidebar rail in the gap, lit as the splitters are', () => {
    expect(css).toMatch(/\[data-slot='sidebar-rail'\] \{\s*margin-right: calc\(var\(--island-gap\) \/ -2\)/);
    expect(css).toMatch(/--island-handle-width:\s*2px/);
    expect(css).toMatch(/--color-splitter-hover:\s*transparent/);
    expect(css).toMatch(/center \/ var\(--island-handle-width\) 100%/);
    expect(css).toMatch(/sidebar-rail'\]::after \{\s*left: calc\(50% - var\(--island-handle-width\) \/ 2\);\s*width: var\(--island-handle-width\)/);
    expect(css).toMatch(/sidebar-rail'\]:hover::after[^{]*\{\s*background-color: var\(--island-handle\)/);
  });

  // Collapsed, the line sits against the editor, at the right of the margin.
  it('puts the collapsed rail\'s line against the editor', () => {
    expect(css).toMatch(
      /\[data-state='collapsed'\] \[data-slot='sidebar-rail'\]::after \{\s*left: calc\(50% \+ var\(--island-gap\) \/ 2 - var\(--island-handle-width\)\)/,
    );
  });

  // flexlayout's own hover paints --color-background, the window's colour here.
  it('leaves a selected tab its colour under the pointer', () => {
    expect(flexlayout).toMatch(
      /\.flexlayout__tab_button--selected:hover \{\s*background-color: var\(--color-tab-selected-background\)/,
    );
  });

  // The first tab is one shape with its pane: on its left edge, no flare,
  // the corner square under it.
  it('starts the first tab at the pane\'s edge, with no flare that side', () => {
    expect(css).toMatch(/tab_container \{\s*padding-left: 0;/);
    expect(css).toMatch(
      /\.flexlayout__tabset:not\(:has\(\.header-controls-spacer\)\)\s*\.flexlayout__tab_button--selected\[data-layout-path\$='\/tb0'\]::before \{\s*display: none/,
    );
    expect(css).toMatch(/\.flexlayout__tab\[data-layout-path\$='\/t0'\] \{\s*--pane-tl: 0px;\s*border-top-left-radius: 0;\s*\}/);
  });

  // Collapsing moves the tabs with the sidebar: in the pane the header
  // controls overhang, the room the first tab keeps from them (its flare,
  // then the pane's corner) comes in with them, every frame, never a step.
  it('grows the first tab\'s flare, then the corner, as the controls come in', () => {
    expect(controls).toMatch(/layout\.style\.setProperty\('--overhang', `\$\{overhang\}px`\)/);
    expect(flexlayout).toMatch(/\.header-controls-spacer \{[^}]*width: max\(0px, var\(--overhang, -100vw\)\)/);
    expect(css).toMatch(/--tabs-room: calc\(var\(--tab-curve-r\) \+ var\(--island-radius\)\)/);
    expect(css).toMatch(/--tabs-pad: clamp\(0px, var\(--overhang, -100vw\) \+ var\(--tabs-room\), var\(--tabs-room\)\)/);
    expect(css).toMatch(/:has\(\.header-controls-spacer\)\s*\.flexlayout__tabset_tabbar_inner_tab_container \{\s*padding-left: var\(--tabs-pad\)/);
    expect(css).toMatch(/--flare: min\(var\(--tabs-offset\), var\(--tab-curve-r\)\)/);
    expect(css).toMatch(
      /\[data-layout-path\$='\/ts0\/t0'\](:not\(\[data-layout-path\*='[1-9]'\]\)){9},[^{]*\{\s*--pane-tl: clamp\(0px, var\(--tabs-offset\) - var\(--tab-curve-r\), var\(--island-radius\)\);\s*border-top-left-radius: var\(--pane-tl\)/,
    );
  });

  // With borders on, the tabs keep the classic tab bar's outlines and line;
  // without, Islands turns them off.
  it('keeps the classic tab bar\'s outlines under island borders', () => {
    expect(css).toMatch(
      /:root\[data-islands='true'\]:not\(\[data-phone-layout\]\):not\(\[data-island-borders='true'\]\) \.flexlayout-custom \.flexlayout__layout \{\s*--color-tab-outline: transparent/,
    );
    expect(css).toMatch(
      /:not\(\[data-island-borders='true'\]\) \.flexlayout-custom \.flexlayout__tabset_tabbar_outer \{\s*box-shadow: none/,
    );
    // One ring under the tabs, the tab bar's last pixel row down, so the
    // selected tab opens into it; the content layer is clipped to its inside.
    expect(css).toMatch(/\.flexlayout__tabset::after \{[^}]*inset: 39px 0 0;[^}]*border: 1px solid var\(--color-tab-outline\)/);
    expect(css).toMatch(/border-radius: var\(--pane-tl\) var\(--island-radius\) var\(--island-radius\)/);
    expect(css).toMatch(/clip-path: inset\(\s*0 1px 1px round max\(0px, calc\(var\(--pane-tl\) - 1px\)\)/);
    // The first tab's left line is drawn inside it, and the top-left corner is
    // square while it is selected.
    expect(css).toMatch(/translate: var\(--tab-edge\) 0;\s*padding-left: calc\(8px \+ 0\.125rem - var\(--tab-edge\)\);\s*padding-right: calc\(4px \+ 0\.125rem \+ var\(--tab-edge\)\)/);
    expect(flexlayout).toMatch(/box-shadow: 0 0 0 1px var\(--color-tab-outline\)/);
    expect(css).toMatch(/flexlayout__tabset:has\(\.flexlayout__tab_button--selected\[data-layout-path\$='\/tb0'\]\) \{\s*--pane-tl: 0px/);
    expect(app).toMatch(/@custom-variant island-borders/);
    expect(sidebar).toMatch(/island-borders:border /);
  });

  // Touch-first (the iPad): no edge on the right or at the bottom, so the
  // content runs to the screen's edge there and the corners that side are square.
  it('runs the panes to the right and bottom edges on touch', () => {
    expect(shell).toMatch(/islands:touch:pr-0 islands:touch:pb-0/);
    expect(css).toMatch(
      /\[data-touch\] \.flexlayout-custom \.flexlayout__tabset_content,[^{]*\.flexlayout__tab \{\s*border-top-right-radius: 0;\s*border-bottom-right-radius: 0;\s*border-bottom-left-radius: 0;/,
    );
    // The ring (island borders) follows: the strip is 44px, no right or bottom side.
    expect(css).toMatch(/\[data-touch\] \.flexlayout-custom \.flexlayout__tabset::after \{\s*inset: 43px 0 0;\s*border-right-width: 0;\s*border-bottom-width: 0;/);
    // The pane header is a layer over the ring, so it is held 1px off the
    // ring's left side and does not paint out the border there.
    expect(css).toMatch(
      /\[data-touch\] \.flexlayout-custom \.flexlayout__tab \{\s*clip-path: inset\(0 0 0 1px round max\(0px, calc\(var\(--pane-tl\) - 1px\)\)/,
    );
  });

  // Under a native view the ring's fill would cover the surface: it is a
  // pseudo-element, which `seeThrough()` cannot mark transparent, so the ring
  // clears its own background the moment the tabset is `data-native-under`.
  it('lets a native view show through the ring\'s fill', () => {
    expect(css).toMatch(
      /:root\[data-islands='true'\]:not\(\[data-phone-layout\]\)\[data-island-borders='true'\] \.flexlayout-custom\s*\.flexlayout__tabset\[data-native-under\]::after \{\s*background: transparent;/,
    );
    // app.css's own `data-native-under` rule only reaches elements.
    expect(app).toMatch(/\[data-native-under\] \{[^}]*background: transparent !important/);
  });

  // A native view (PDF, drawing) makes the pane and the window behind it
  // see-through, so the gaps and the pane's rounded corners show the native
  // host's colour: the window's under Islands, not the notes'.
  it('paints the window\'s colour behind a native view under Islands', () => {
    expect(surfaces).toMatch(/dataset\.islands === 'true'/);
    expect(surfaces).toMatch(/cssColour\('--sidebar'\)/);
    expect(surfaces).toMatch(/attributeFilter: \['data-theme', 'data-islands'/);
    // The view's own margins (a PDF's) stay the pane's colour: the surface
    // gets it as its backdrop, whatever the host paints.
    expect(surfaces).toMatch(/return background;/);
    // Dark paper takes the theme's own background, told to the native side as
    // `paper` alongside the host's colour.
    expect(surfaces).toMatch(/cssColour\('--background'\)/);
    expect(surfaces).toMatch(/paper: themeGround\(\) \?\? undefined/);
    expect(readFileSync(path.resolve(__dirname, '../components/native-surface.tsx'), 'utf8')).toMatch(
      /visible, backdrop[,)]/,
    );
  });
});
