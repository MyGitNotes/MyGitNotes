/**
 * The product's rule for an agent about note templates, said in the `list_templates` and `save_note` descriptions and in
 * the server's instructions, so every connector reads it without a notebook writing it down.
 */
export const TEMPLATE_GUIDANCE = "Before creating a note, call list_templates with a query for the kind of note. When a template fits, ask the user whether to use it, then create the note with save_note's template and values, filling every declared placeholder you can. A notebook's AGENTS.md may say otherwise.";
