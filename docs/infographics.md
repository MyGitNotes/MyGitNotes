# Infographic directives

Write these blocks in a note’s Markdown and switch to Live Preview to see the figures.
To change one in Live Preview, use its **Markdown** button; these three kinds don’t use the data grid.
Use `｜` (the full-width vertical bar) between fields.
Inline Markdown and `$…$` work in list fields; titles and subtitles are plain text.
A malformed figure shows an error and its source in place, without interrupting the rest of the note.

## Process (`process`)

Use four colons around the process, and three around each stage.
Every stage needs a `title`; `time` is optional and `highlight` emphasizes the stage.
Write `- Item｜Detail` for each item, omitting the detail if you don’t need it.
A stage with more than four items lays them out in a grid.

A stage can have up to two `- ↺ Earlier stage｜Condition` rows.
Each target must match the title of a previous stage exactly.
The condition is optional, and fall-backs don’t count toward the item grid.

```markdown
::::process{title="Publication workflow"}
:::stage{title="Draft" time="08:00"}
- Check the references｜Follow each link to its source
:::
:::stage{title="Review" highlight}
- ↺ Draft｜A claim needs more evidence
:::
::::
```

## Decision tree (`decision`)

Write one nested list with one root question, followed optionally by `｜What to do first`.
The tree takes two to five questions with two or three branches per question.
Each branch is `- Label｜Conclusion` or `- Label｜Next question｜What to do first` with a child list.
At most one branch per question can lead to another question; the preview draws that branch last.
Wrap a conclusion in `**…**` to highlight it, or start it with `↺` to mark a return to an earlier question.

```markdown
:::decision{title="Can we publish?"}
- Are the claims sourced?
  - No｜↺ Check the references and start again
  - Yes｜Has an editor read it?｜Ask someone who didn’t write it
    - Yes｜**Publish**
    - No｜Wait for review
:::
```

## Nested sets (`nested`)

Write a single flat list of two to five ranges, from the outside in.
Use `- Name｜Description`, omitting the description if you don’t need one.
To highlight a range, put its name in `**…**`.

```markdown
:::nested{title="Number sets"}
- Real numbers｜$\mathbb{R}$
- Rational numbers｜$\mathbb{Q}$
- **Integers**｜$\mathbb{Z}$
:::
```
