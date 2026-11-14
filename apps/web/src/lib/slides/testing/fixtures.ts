/** The fixture decks (see `../fixtures/README.md`) and how the tests read them. Test-only. */
import headings from '../fixtures/headings.md?raw';
import backgrounds from '../fixtures/backgrounds.md?raw';
import kickerBuilds from '../fixtures/kicker-builds.md?raw';

/** A fixture deck's body, without its frontmatter, and the title its frontmatter gives. */
function fixture(name: string, text: string): [name: string, body: string, title: string] {
  return [name, text.replace(/^---\n[\s\S]*?\n---\n/, ''), /^title: "?(.*?)"?$/m.exec(text)![1]];
}

/** The decks, written as every slide note is read: `---` is a block, `##` a slide, `###` a page. */
export const FIXTURE_DECKS = [fixture('headings.md', headings), fixture('kicker-builds.md', kickerBuilds), fixture('backgrounds.md', backgrounds)];
