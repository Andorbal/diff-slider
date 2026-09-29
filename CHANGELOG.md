# Changelog

## 0.2.0

- Commits that don't change what the diff shows (renaming the file, changing its mode, or converting its line endings) are hidden from the timeline. Uncheck **Content changes only** in the toolbar, or set `diffSlider.contentChangesOnly` to `false`, to show them.
- A commit that only converts line endings shows no changed lines on the timeline and commit card, matching the diff.

## 0.1.0

First release.

- A timeline of the commits that changed a file, with the working copy (and staged changes) at the right end.
- Two independent handles select the two sides of the diff; the leftmost one is always the old side. The diff updates live while dragging.
- A commit card follows the handle (message, author, date, line counts, tags) and has actions to show that commit's change, open the file at that revision, or copy the SHA.
- Change-size histogram, tag markers and date labels on the timeline.
- Loads older history on demand: drag to the left end, or click **Older** (Shift+click loads everything).
- Follows renames, includes merge commits (diffed against the first parent), and has an optional first-parent-only mode.
- The working copy side updates as you type; the panel refreshes after commits and staging.
- Keyboard control, including stepping both handles through history together.
- Side-by-side/inline, ignore whitespace, collapse unchanged regions and word wrap toggles; moved-code detection.
- Opens the current comparison in VS Code's diff editor.
- Available from the editor title bar, Explorer, editor tabs, Source Control and Timeline context menus, and `Ctrl+Alt+H` / `⌃⌘H`.
- Panels are restored after a window reload.
