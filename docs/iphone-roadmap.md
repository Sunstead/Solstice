# iPhone: from usable to native

What it takes for Solstice on an iPhone to feel like an app built for it, not
a web page in an app. It comes from running the iOS app on the iPhone 18 Pro
simulator (iOS 27, a debug `aarch64-sim` build, 2026-10-24) on a seeded
workspace (notes, a task board, a PDF, an image, nested folders), and from
reading the phone shell (`components/mobile/`), the native plugin
(`src-tauri/plugins/native`) and the shared layout code.

The yardstick is the patterns iOS developers follow (Apple's own apps, and
apps like Instagram and Discord), not every line of the Human Interface
Guidelines. Where Solstice already has its own way (the file tree, the themes,
the You tab), it keeps it and is made to feel at home. The decisions taken so
far are at the end.

Phases run in order: 0 is broken behaviour, 1 is the look and feel from the
web side, 2 is the few native controls the web can't match, 3 is the tab bar,
4 is polish and the rest of the platform.

---

## Phase 0: bugs that break the phone

### 0.1 Opening a PDF, drawing or image leaves the file list painted over it, and nothing can be tapped

**Seen:** open `Reading/Paper.pdf` from Files. The PDF draws, but the Files
page's rows draw on top of it (their text over the page, the backgrounds
gone). Tap Back: the note pane slides away, but the PDF stays where it was,
the Files page stays see-through over it, and taps on the tab bar go through
to the PDF. The only way out is quitting the app. The same happens with
anything drawn natively: PDFs, notebooks, drawings, markable images.

**Why:**

1. `seeThrough` (`lib/native-surfaces.ts`) marks every element under the
   surface at five sample points as `data-native-under`, which clears its
   background. On the iPad that's flexlayout's tabset; on a phone it's the
   whole Files page, because the note is a `PushPane` stacked over home, not
   beside it. Home's backgrounds go transparent but its text stays, and the
   webview is over the native view, so the file list draws over the PDF.
2. `PushPane` moves by `transform` and hides with `visibility: hidden`
   (`push-pane.tsx`, `finish`). Neither resizes anything, scrolls, or adds
   children to `<body>`, so `follow` is never kicked and the surface is never
   measured again. `measure` would miss it anyway:
   `checkVisibility()` without `{ visibilityProperty: true }` ignores
   `visibility: hidden`, and a pane moved off by `translateX(100%)` still has
   a non-zero rect.
3. So the native view keeps its frame (the whole pane), stays shown, and
   `hitTest` hands it every touch in that frame, tab bar included.

**Fix:**

- `seeThrough` stops at the surface's own page: walk the stack only while the
  element is the surface's ancestor or inside the same `.solstice-push-page`
  (or another explicit `data-surface-root`). Nothing on another page is ever
  marked.
- While a pushed page is fully in, hide what it covers (`visibility: hidden`
  on home, as UIKit takes the covered view out of the window). That also
  saves painting home under a note.
- `PushPane` kicks the surfaces (`overSurfaceMoved()`, or a new
  `kickSurfaces()`) when it starts and finishes a slide, and on every scroll
  of a swipe.
- `measure` treats a surface as hidden when `checkVisibility({
  visibilityProperty: true, opacityProperty: true })` is false, when it's
  inside an `inert` subtree, or when its rect is off the viewport.
- Test: a `native-surfaces` test that a surface in a push page never marks an
  element outside it, and a `push-pane` test that open/close kicks.

### 0.2 Turning the phone to landscape turns it into the iPad app

**Seen:** in a note, rotate the iPhone. At 874 pt wide the app is past the
768 px breakpoint (`useIsMobile` in sunstead-ui), so `EditorArea` swaps
`PhoneShell` for `FlexLayoutRoot` and `AppShell` brings in the title bar,
rail, explorer island, tab strip and window-style header controls, all
squeezed into 402 pt of height. Rotating back remounts `PhoneShell` on the
Files page; the note you were in is closed.

**Fix:** lock the iPhone to portrait. `UISupportedInterfaceOrientations`
(the iPhone's key, not `~ipad`) becomes Portrait alone, in both
`gen/apple/project.yml` and `gen/apple/solstice_iOS/Info.plist` (kept in step
by hand, as the icon settings are). The iPad keeps every orientation. As a
guard, an iPhone always gets the phone layout whatever its width
(`can.phoneLayout`, from `UIDevice.current.userInterfaceIdiom == .phone`),
so a future change to the plist or the breakpoint can't bring this back.

### 0.3 Swipe back doesn't work on anything that scrolls sideways

**Seen:** on a task board, a swipe from the very left edge scrolls the board
(or does nothing) instead of going back. The same goes for a wide table or
code block, a canvas, and every native view (PDF, drawing, image), whose
touches the webview never sees.

**Fix:** the screen edge belongs to navigation. Give `solstice-push-page` a
20 pt strip down its left edge, above the content and transparent, that
belongs to the pane's own scroller (so a drag there is the pane's swipe,
followed on the compositor like the rest). Register it with `useOverSurface`
so it stays the webview's over a native view. Keep the full-width swipe for
content that doesn't scroll sideways (iOS 26 does the same).

### 0.4 Smaller breakages seen on the way

- **White flash at launch.** The launch screen is `systemBackgroundColor`
  (white in light mode) and the webview is white until `index.html` paints,
  about 1.5 s on the simulator, then the app is dark. Save the last theme's
  background natively (UserDefaults, as the ink tools are) and paint the
  window and webview with it from the first frame. Make the launch screen
  match.
- **The first tap after a menu closes is lost.** Seen several times (the row
  tapped right after dismissing a context menu didn't open). Base UI's
  outside-press guard swallows it. The hold sheet (1.5) replaces these menus
  on the phone; any menu that's left lets the closing tap land.
- **Rows stay highlighted.** The tapped file keeps the desktop "active"
  highlight after you go back, and a second row (the last opened) stays lit
  too. On a phone a row flashes as it's tapped and clears as you come back.
- **Extensions leak.** The new-tab page's Recent shows `Groceries.task`; the
  search page shows `Projects/Groceries.task.md` under the name.
- **`%%comments%%` show their markers** in the rich editor when the caret isn't
  in them.
- **An empty workspace shows nothing** under its header. It needs an empty
  state (an icon, "No notes yet", a New Note button).

---

## Phase 1: the look and feel, from the web side

Everything here is CSS and React in the phone shell. The desktop's colours and
theme system stay as they are; what changes is how the phone lays them out.

**Where it stands (2026-10-25, branch `iphone-native`).** Done, and checked
in the simulator unless it says otherwise:

- 1.1 to 1.6, 1.8 to 1.10 as written, with these differences:
  - The tint is `--primary`. On the darker themes that's near white, so
    tinted buttons read as plain white there.
  - Dynamic Type scales the whole UI's root size, clamped to 0.82 to 1.35×
    (`lib/dynamic-type.ts`). Not tried at other text sizes.
  - Holds: a folder's colours are swatches inline in the sheet rather than
    a page pushed inside it. A task board card's hold keeps its own menu.
  - Import from sync, Move and folder colour open as bottom sheets, but
    still use the desktop's header and buttons. Only the name dialog and New
    Workspace have the Cancel / title / confirm bar (`FormLayout`).
  - Text fields: there's no clear button yet.
  - The Aa panel opens above the bar rather than in place of the keyboard.
    A sheet would take focus and drop the keyboard.
  - Haptics: all of the table except pull to sync, whose `light` tick was
    not felt in the simulator.
  - Pull to sync shows only in a linked workspace, and only works on a list
    long enough to scroll. Neither was tried here.
- 1.7: Bookmarks folders are pushed pages. The tree has 44pt rows, a folder
  count on the right, no indent guides and a spring on the chevron.
  Settings are grouped rows with checkmark lists. Window and tab-strip
  options are hidden. Sheets have a grabber and no X.

Left for later:

- **Swipe actions on rows.** A swipe left on home already brings the last
  note back (`useSwipeToNote`), so swiping left for Delete needs deciding
  first: either give that up on rows, or open Delete with a swipe right.
- **A search field under Files' large title.** Pulling down already syncs,
  and the Search tab already searches.
- **Children easing in** when a folder opens.
- **Large titles shrinking** on a long list. Not tried.
- **The first tap after a transition is sometimes lost.** It shows after
  closing a sheet or going back. It looks like UIKit ending the scroll view's
  settle animation. Not fixed.

### 1.1 Pages on the notes' colour, no borders

Today every phone page is `bg-sidebar` with a `border-b` under its header and
a `border-t` over the tab bar, and Islands leaves a ~6 pt gap down the left
edge (`SidebarInset` keeps `islands:p-(--island-gap)` because the sidebar
isn't "collapsed"; it doesn't exist).

- **Every tab's content is on `--background`**, as an island is: Files,
  Bookmarks, Search and You, and every pushed page. The sidebar colour is
  left for what sits over the content (sheets, the keyboard bar), the way
  Islands puts panels on the window.
- **Islands is off on the phone**: `data-islands` isn't set in the phone
  layout (or `islands:` is scoped out of it), its rows are hidden from
  Appearance, and the gap goes. The phone has one look.
- **No header border.** The bar is the page's own colour, so at rest it isn't
  there at all: only the title and buttons float at the top. Once content
  scrolls under it, the bar fades in as a translucent blur of the page
  (`backdrop-filter`, the page colour at ~80%) with a soft fade at its lower
  edge rather than a line, which is iOS 26's scroll edge effect. The tab bar
  works the same way from the bottom (Phase 3 makes it the floating bar).
- **Large titles** on the root of each tab (the workspace name on Files,
  Bookmarks, Search, You), shrinking into the bar as the list scrolls.
- **Lists** keep the theme's tokens: rows on `--background`, groups (on You
  and in sheets) on `--card` with no outer border, hairline separators inset
  past the icon.

### 1.2 Colour, font and type

- **Tell UIKit the appearance.** `color-scheme` is never set
  (`lib/theme/apply.ts`), so the keyboard, the text-selection loupe and every
  native picker are light over a dark theme. On iOS, set the window's
  `overrideUserInterfaceStyle` from the theme's appearance (a `host` op). That
  reaches the keyboard and every UIKit view without restyling web controls,
  which is what CSS `color-scheme` would do.
- **The system font for chrome.** The UI is Inter (`--font-sans`). On iOS,
  labels, titles, rows and buttons are SF Pro (`system-ui`), which also
  brings SF's tracking at each size. The note font setting is unchanged; only
  its default on iOS becomes the system font.
- **Dynamic Type.** Chrome sizes come from the text styles
  (`-apple-system-body`, `-apple-system-headline`, ...) so they follow the
  user's text size; the note's base size follows `body` unless set.
- **Accent as tint** for what can be tapped in bars (Back, New, Done), as
  UIKit tints them.

### 1.3 One note at a time: no tabs on iPhone

- The phone already opens files in place (`openInPlace`). On iPhone the
  layout model keeps only that tab: the tab count button, `TabSwitcher` and
  "New tab" go, and opening the app prunes the model to its shown tab.
- Going back through notes is the back button and swipe (the phone history,
  `phone-nav.ts`), with Back and Forward kept in ⋯. Getting to another note
  is Files, Search, Bookmarks and Recents.
- The blank tab's page (`TouchBlankTab`: New note, Open note, Recent) stays
  as what Files shows when nothing's open to go back to; it's no longer a tab.
- The phone layout elsewhere (a narrow desktop window, the web on a phone)
  hides the switcher too, but leaves the model's tabs alone, so widening the
  window brings them back.

### 1.4 Bars and the note's header

- **Pushed pages:** 44 pt bar, title centred and semibold, a back chevron
  carrying the previous page's name ("‹ Notes", "‹ You"), tinted buttons with
  44 pt targets, no border (1.1).
- **The note header** drops to back, the title, share and ⋯ (Notes has about
  as many). Sync shows only when it has something to say (offline, a merge
  waiting).
- **The tab bar** keeps its icons with no labels (the Instagram look) and the
  avatar for You. Selected icons are filled. Tapping the current tab goes
  back to its root, and tapping again scrolls to the top.
- **Scroll indicators.** Notes show the desktop's always-visible custom
  scrollbar. On touch, use WebKit's own overlay indicators (no
  `::-webkit-scrollbar` styling under `data-pointer='touch'`).

### 1.5 Holding a file or folder: a sheet, as Discord does

A hold on a file or folder (the tree, Bookmarks' cards and rows, a search
result, a task board card) opens a bottom sheet of what can be done with it,
not a menu at the finger. Today it's the desktop context menu, anchored where
you pressed, with no feedback and items that don't belong on a phone (Open in
New Tab, Reveal in Explorer while you're in the explorer, Copy Path
(Absolute), Save a Copy...).

The flow:

1. **Hold** 400 ms (the system's long press). At the moment it's recognised,
   the impact haptic plays and the row dips (scale 0.97, its highlight on).
   Moving first is a scroll or a drag and never opens the sheet.
2. **The sheet rises** (`components/ui/sheet.tsx` on `touch-pane.tsx`,
   already compositor-driven with swipe-down to close) at its medium height;
   dragging it up takes it to full height when the list is long.
3. **Its header is the item**: its icon (the folder in its colour), its name,
   and its folder ("Projects · 3 notes"), like Discord's channel sheet.
4. **A row of round quick actions** under the header for the three things
   done most: Bookmark (filled when bookmarked), Share, Rename. Then grouped
   rows: Open (notes), New Note/Folder Here (folders), Duplicate, Move to...,
   Color (folders; pushes a page of swatches inside the sheet), Copy Link,
   and Delete, red, in a group of its own at the bottom.
5. **Choosing** closes the sheet and does it. Anything that needs more (a
   name, a folder, a confirmation) is another sheet (1.6), never a dialog over
   a sheet.

What builds it: every surface already gets its items from
`useEntryMenuItems` (`file-tree-context-menu-content.tsx`,
`bookmarks-view.tsx`'s `AnchoredEntryMenu`/`FolderEntryMenu`), and the note's
⋯ sheet already turns that list into rows (`FileRows` in `note-pane.tsx`). So
it's one `EntryActionSheet` taking an entry, with a `surface: 'phone'` in
`useEntryMenuItems` deciding the phone's items and which three are quick
actions. The note's ⋯ opens the same sheet (with Find, Show Source, Back and
Forward at the top). A long-press hook shared with `tab-gesture.ts`'s timing
replaces `ContextMenuTrigger` in the phone layout; the desktop and iPad keep
their menus.

### 1.6 Forms and confirmations are sheets

- **Forms:** "New workspace" is a centred desktop card at the top of the
  screen with both an X and a Cancel button. On the phone it's a sheet:
  Cancel on the left, the title in the middle, Create (bold, tinted,
  disabled until valid) on the right, fields as a grouped list. Same for
  rename, new note/folder (`NameEntryDialog`), move, import from sync, folder
  colour.
- **Confirmations:** deleting is a small sheet from the bottom with a red
  Delete and Cancel, as an action sheet is.
- **Text fields** are iOS's: no focus ring, a clear button, the return key
  named for what it does (`enterkeyhint`: Done, Search, Go).

### 1.7 Lists

- **Files keeps the tree**, made to feel at home: rows on `--background`
  (1.1), 44 pt tall, the chevron rotating with a spring as a folder opens,
  children easing in, no indentation guides, a quiet detail on the right
  (count for folders), a search field under the large title, revealed by
  pulling down. iOS's own Files list view expands folders in place the same
  way.
- **Bookmarks drills in.** It already opens folders in place, notebook-style,
  with a trail back (`BookmarksView`). On the phone each folder becomes a
  pushed page (`PushPane`, swipe back, the folder's name in the bar and the
  parent's on the back button) instead of the in-page trail.
- **Swipe actions on rows:** swipe left for Delete (red, a full swipe
  deletes after the confirmation sheet) and More (the hold sheet); swipe
  right to Bookmark. With haptics (1.8).
- **Settings:** each setting an iOS row: a toggle is a trailing switch, an
  enum pushes a list with a checkmark (or a small inline choice for two or
  three options), a number is a stepper or slider row, with a group footer
  explaining instead of a description under each label. Hide what can't
  apply on iOS (theme folder "Reload", most of Keyboard without a hardware
  keyboard, window and tab-strip options). The You page's layout stays.
- **Workspaces and New sheets** keep the grabber and lose the X.

### 1.8 Haptics

Today only tab, slot and board drags and the squeeze palette tick
(`lib/haptics.ts`). Add, through the same `haptics.play`:

| When | Feedback |
| --- | --- |
| A hold opens the item sheet | impact, medium |
| A swipe action passes its commit point | impact, medium |
| A toggle flips, a choice is checked | selection |
| A checkbox in a note or on a board is ticked | selection |
| Pull to refresh (sync) triggers | impact, light |
| A sheet is swiped away | already `dismiss` |
| Something is created or moved | success |
| A delete is confirmed | warning |
| A drag lifts / drops / crosses a slot | already done |

`HapticKind` grows `select`, `success`, `impactLight`, `impactMedium`; the
Swift side (`Haptics.swift`) keeps one generator per style, prepared on
pointer down.

### 1.9 The keyboard

- **Hide WebKit's form accessory** (the ^ ∨ ✓ bar). On the phone it stacks
  under the KeyboardBar, so a note has two bars over the keyboard, and on
  every other field it gives the web away. Swizzle `inputAccessoryView` on
  WKContentView to `nil` (in `MethodHooks.swift`), keeping KeyboardBar's own
  dismiss button as the way to put the keyboard away.
- **The keyboard's colour** follows the theme (1.2).
- **KeyboardBar** is Notes' format bar: SF-style icons on a glass strip, and
  an Aa button that opens a format sheet (headings, lists, styles) rather
  than one long scrolling row.

### 1.10 Notes themselves

- Content margins of 20 pt on a 402 pt phone (today ~23 pt, plus the Islands
  gap of 1.1).
- Tap the title in the bar to rename.
- Pull down at the top of Files and Bookmarks to sync (when linked).

---

## Phase 2: native controls where the web can't match them

The hold sheet (1.5) and the ⋯ sheet stay web, since a sheet is something the
web side already does well. What's left for the plugin (which already has the
iPad menu bar in `NativeMenu.swift`, the share sheet and the colour picker) is
small:

- **Alerts** (`UIAlertController`) for the rare centred confirmation (sign
  out, discard a conflict).
- **Pickers:** date (for front matter), photos (already native for ink),
  document import from Files (`UIDocumentPickerViewController`).

## Phase 3: the tab bar

On iOS 26+ the tab bar is a floating Liquid Glass capsule over the content.
Glass refracts and lenses what's under it; CSS `backdrop-filter` can only
blur, so a web copy is the one piece of chrome that will always look slightly
off.

The plan:

1. **First, web bars done well** (Phase 1): no borders, a translucent blurred
   bar that only appears over scrolled content, a floating rounded tab bar
   with spring animations. That is good enough to ship.
2. **Then a native tab bar** over the webview: a `UITabBar` in the iOS 26
   floating style, items and the selected tab sent from the web
   (`host { op: 'tabBar', items, selected }`), taps sent back, the You avatar
   as the item's image, hidden while a note is pushed or the keyboard is up.
   It's the same four items on every page, so the bridge stays small. This
   is the first native view *above* the webview; touches over it are its own.
3. **Navigation bars stay web.** They change with every page and have to move
   with the push spring and the swipe; a native bar would animate on its own
   clock and drift from the page under it. Phase 1's borderless bar with the
   scroll edge effect is what iOS 26 bars look like at rest anyway.

## Phase 4: polish and the rest of the platform

- **VoiceOver:** every control has a label (most do, via `sr-only`), rows
  announce "folder" / "note", headings are headings, pushed pages and sheets
  move focus. Run the Accessibility Inspector over every page.
- **Reduce Motion / Reduce Transparency / Increase Contrast** are already
  read for tab motion; the push, sheets and blurred bars follow them too.
- **Ink on iPhone.** The ink ribbon is the iPad's (a row under the header).
  On a phone it's Notes' markup toolbar: tools along the bottom, colours in a
  popover, finger drawing on by default (there's no Pencil), two-finger pan.
- **Home-screen quick actions** (New Note, Search), **Spotlight** for note
  titles, **Handoff** to the Mac, **Shortcuts** actions (New Note, Append to
  Note), a **widget** for bookmarks or recent notes, **Live Text** in images
  and PDFs.
- **State restoration:** relaunching returns to the page and scroll position
  you left (today it lands on Files).

---

## Every page, in short

| Page | Today | After |
| --- | --- | --- |
| Launch | white flash, then dark | the theme's colour from the first frame |
| Files | tree on the sidebar colour, header border, persistent highlight | tree on `--background`, large title, borderless bar, search, swipe actions, hold sheet |
| Note | 4 header buttons, tabs, custom scrollbar, Islands gap, two bars over the keyboard | back, title, share, ⋯; one note at a time; overlay indicator; one format bar; keyboard in the theme |
| Task board | swipe back blocked | edge swipe always goes back; card hold = the item sheet |
| PDF / drawing / image | file list over it, can't leave (0.1) | full-bleed, Notes-style markup toolbar, finger drawing |
| Search | outlined field with Aa/ab, no Cancel | iOS search field with Cancel; results hold for the item sheet |
| Bookmarks | in-page trail | folders as pushed pages, swipe back, hold sheet |
| You / Settings | desktop dialog panes, radio cards, shadcn switches | same page, iOS rows: switches, checkmark lists, footers |
| Sheets (New, Workspaces, ⋯) | grabber plus X, outlined buttons | grabber only, grouped rows; ⋯ is the item sheet |
| Dialogs | centred desktop cards | form sheets with Cancel / action in the bar |
| Landscape | becomes the iPad app | locked to portrait |

---

## Decisions (2026-10-24)

1. **Chrome:** native feel preferred, web bars fine if they look right. Web
   bars first, then a native floating tab bar; navigation bars stay web
   (Phase 3).
2. **Files keeps the tree.** Drill-in is Bookmarks' flow.
3. **No tabs on iPhone** (1.3).
4. **Themes:** the desktop colours and theme system, unchanged. The phone
   lays them out differently (1.1).
5. **You stays a tab**, as Instagram's profile tab is. General iOS patterns,
   not every Apple guideline.
6. **iPhone is portrait only** (0.2).
7. **Every tab's content is on `--background`**, no header borders (1.1).
8. **Holding a file or folder opens a sheet**, as Discord's channels do
   (1.5).

## Testing it

The simulator covers almost all of this:
`npm run tauri -w @solstice/desktop -- ios build --debug --target aarch64-sim`
(its last rename step fails; the app is in
`gen/apple/build/solstice_iOS.xcarchive/Products/Applications/`), then
`xcrun simctl install`/`launch` on an iPhone 18 Pro (iOS 27). Seed a
workspace by writing into the app's `Documents/<name>/` from the Mac; the
poller picks it up in 2 s. Haptics and Pencil need a device.
