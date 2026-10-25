Status: accepted (the owner accepted every default of the decision table, 2026-10-25)

# Image annotations: decisions

Spec: [spec.md](spec.md).

| Question | Choice | Why |
|---|---|---|
| Image ref | First body line, an ordinary Markdown image | File moves rewrite it, Pro copies it, other renderers still show it; a `src=` attribute would break on the first move |
| Coordinates | Percent with `%`, 0–100 | Readable without help and passed to SVG as written; still normalised for PDF later |
| Ids | Integers `#n`, highest plus one, never renumbered | A stable "pin 3" in talk, diffs and pages |
| Author | Optional `by=`, filled when the session knows a login | Several reviewers per history; local mode and the demo have no identity |
| Resolved default | Collapsed (hidden), one click shows | The Figma and Markup.io default; CSS-only, so it works on public pages |
| Public pages | Show annotations, resolved collapsed | The owner wants Pro public pages to show them |
| Typos and unknown words | A row problem is shown, the text is kept | Fail visibly, not silently |
| Edit write timing | Each action is one document change; the widget keeps its DOM through `updateDOM` | Undo, drafts and commits stay CodeMirror's |
| Public-page language | `createNoteRenderer({ language })`, default English | A server has no `<html lang>`; the owner asked for the note's language on Pro pages |
| Annotated image entry | Both the Annotate button on an image line and the Insert group's Annotated image | The menu entry is small |
