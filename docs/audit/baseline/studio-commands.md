# S1000D Studio commands (baseline)

Captured 2026-11-27 from `frontend/src/studio/ui/commands.ts`. Every command is reachable from the ribbon, the File menu or the command palette; `keys` are the registered accelerators. Phase 2 may re-home a command but none may disappear and no accelerator may change without a recorded decision. Commands whose shortcut is only mentioned in the description (for example Ctrl+X) are handled by the browser or by `ui/app.ts`.

87 commands written out literally in the registry. Five helper sites in the same file generate more (emphasis types, table operations, cell alignment, view modes and the helper at line 60); a text scan cannot expand them. The first step of Phase 2 is to dump the registry at run time (every id, label, group, accelerator) and add it here; that needs a stable browser (see report 16, GAP-007).

| Id | Label | Group | Registered keys | Note |
|---|---|---|---|---|
| file.new | New data module… | File | Mod+Alt+N |  |
| file.open | Open… | File | Mod+O |  |
| file.save | Save | File | Mod+S |  |
| file.saveAs | Save as… | File | Mod+Shift+S |  |
| file.exportXml | Export XML (download) | File |  |  |
| file.exportHtml | Export as HTML | File |  |  |
| file.exportPdf | Export as PDF… | File |  | S1000D publication PDF: title page, contents lists, data module pages |
| file.close | Close document | File | Mod+Alt+W |  |
| file.samples | Open sample data module… | File |  |  |
| file.recent | Recent files… | File |  |  |
| edit.undo | Undo | Edit | Mod+Z |  |
| edit.redo | Redo | Edit | Mod+Y, Mod+Shift+Z |  |
| edit.cut | Cut | Edit |  | Ctrl+X |
| edit.copy | Copy | Edit |  | Ctrl+C |
| edit.paste | Paste | Edit |  | Ctrl+V |
| edit.pastePlain | Paste as plain text | Edit | Mod+Shift+V |  |
| edit.selectAll | Select all | Edit |  | Ctrl+A |
| edit.find | Find… | Edit | Mod+F |  |
| edit.replace | Replace… | Edit | Mod+H |  |
| edit.findNext | Find next | Edit | F3 |  |
| edit.findPrev | Find previous | Edit | Shift+F3 |  |
| edit.gotoId | Go to ID / target… | Edit | Mod+G |  |
| format.subscript | Subscript | Format | Mod+= |  |
| format.superscript | Superscript | Format | Mod+Shift+= |  |
| struct.insert | Insert element… | Structure | Mod+E |  |
| struct.wrap | Wrap in element… | Structure | Mod+Alt+G |  |
| struct.change | Change element… | Structure | Mod+Shift+E |  |
| struct.removeTag | Remove tag (keep content) | Structure | Mod+Alt+U |  |
| struct.delete | Delete element | Structure | Mod+Shift+K |  |
| struct.selectParent | Select element / parent | Structure | Mod+Shift+ArrowUp |  |
| struct.moveUp | Move up | Structure | Alt+Shift+ArrowUp |  |
| struct.moveDown | Move down | Structure | Alt+Shift+ArrowDown |  |
| struct.demote | Demote (nest) | Structure | Alt+Shift+ArrowRight |  |
| struct.promote | Promote (un-nest) | Structure | Alt+Shift+ArrowLeft |  |
| struct.attributes | Element attributes… | Structure | Alt+Enter |  |
| insert.levelledPara | Levelled paragraph | Insert | Mod+Alt+L | New section after the current one |
| insert.subLevelledPara | Sub-paragraph | Insert |  | New nested section inside the current one |
| insert.para | Paragraph | Insert | Mod+Alt+P |  |
| insert.step | Procedural step | Insert | Mod+Alt+S |  |
| insert.substep | Sub-step | Insert |  |  |
| insert.warning | Warning | Insert | Mod+Alt+1 |  |
| insert.caution | Caution | Insert | Mod+Alt+2 |  |
| insert.note | Note | Insert | Mod+Alt+3 |  |
| insert.randomList | Bulleted list | Insert | Mod+Alt+B |  |
| insert.sequentialList | Numbered list | Insert | Mod+Alt+Q |  |
| insert.definitionList | Definition list… | Insert |  |  |
| insert.table | Table… | Insert | Mod+Alt+T |  |
| insert.figure | Figure… | Insert | Mod+Alt+F |  |
| insert.internalRef | Internal reference… | Insert | Mod+Alt+R |  |
| insert.dmRef | External reference (data module)… | Insert | Mod+Alt+D |  |
| insert.externalPubRef | External publication reference… | Insert |  |  |
| insert.acronym | Acronym… | Insert |  |  |
| insert.verbatim | Verbatim text | Insert |  |  |
| insert.footnote | Footnote | Insert |  |  |
| insert.specialChar | Special character… | Insert |  |  |
| table.delete | Delete table | Table |  |  |
| table.properties | Table properties… | Table |  |  |
| review.validate | Validate (XSD + BREX) | Review | F7 |  |
| review.xsd | Validate against schema | Review |  |  |
| review.brex | Check BREX | Review | Shift+F7 |  |
| review.live | Live validation | Review |  |  |
| review.brexLibrary | BREX library… | Review |  |  |
| review.nextProblem | Next problem | Review | F8 |  |
| review.prevProblem | Previous problem | Review | Shift+F8 |  |
| review.markModify | Mark as modified | Review | Mod+Shift+M |  |
| review.markAdd | Mark as added | Review |  |  |
| review.markDelete | Mark as deleted | Review |  |  |
| review.markClear | Clear change mark | Review |  |  |
| review.clearAllMarks | Clear all change marks | Review |  |  |
| view.outline | Navigation pane | View |  |  |
| view.props | Properties pane | View |  |  |
| view.problems | Problems pane | View |  |  |
| view.zoomIn | Zoom in | View | Mod+Alt+= |  |
| view.zoomOut | Zoom out | View | Mod+Alt+- |  |
| view.zoomReset | Zoom 100% | View | Mod+Alt+0 |  |
| view.theme | Dark theme | View |  |  |
| view.sync | Synchronise selection (Split) | View |  |  |
| view.splitTags | Show tags in Split view | View |  |  |
| view.identToggle | Collapse identification section | View |  |  |
| tools.dmProps | Data module properties… | Tools | Mod+Alt+I |  |
| tools.entities | Declare ICN entities | Tools |  |  |
| tools.images | Linked images… | Tools |  |  |
| tools.ids | Generate missing IDs | Tools |  |  |
| tools.settings | Settings… | Tools | Mod+, |  |
| tools.shortcuts | Keyboard shortcuts | Tools | F1 |  |
| tools.palette | Command palette… | Tools | Mod+Shift+P |  |
| tools.about | About S1000D Studio | Tools |  |  |

The JSS editor (`jss/editor.ts`, `jss/dom.ts`) and the JSG editors (`jsg/editor.ts`, `jsg/ispl-editor.ts`) do not have a registry: their keys are in handlers. Keys seen by a source scan (to be confirmed by hand in the first step of Phase 2):

| File | Keys | Ctrl/Meta tests |
|---|---|---|
| `jsg/editor.ts` | Enter | 2 |
| `jsg/ispl-editor.ts` | - | 2 |
| `jsg/shared.ts` | Escape | 0 |
| `jss/dom.ts` | Enter, Escape | 0 |
| `jss/editor.ts` | ArrowDown, ArrowUp, Backspace, Enter, Tab | 4 |
| `pages/project/EditorPage.tsx` | ArrowLeft, ArrowRight | 0 |
| `pages/project/JsgEditorPage.tsx` | STALE_DOCUMENT | 0 |
| `pages/project/JssEditorPage.tsx` | STALE_DOCUMENT | 0 |
| `studio/ui/app.ts` | ArrowDown, ArrowLeft, ArrowRight, Comma, End, Equal, Escape, Home, Minus | 3 |
