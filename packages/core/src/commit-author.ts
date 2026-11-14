import { SourceError } from './github-api.js';
import { appendTrailers, trailerBlock } from './note-versions.js';

/** Who a commit names: its author, or a co-author in a `Co-authored-by` trailer. */
export interface CommitAuthor {
  name: string;
  email: string;
}

/**
 * What a name or email may not hold. Angle brackets delimit the email in a commit's author line and in a trailer, and a
 * line break ends either, so any of them could add an identity, a header or a trailer of the writer's choosing. Control
 * characters and the Unicode line separators go with them.
 */
const UNSAFE = /[<>\p{Cc}\u2028\u2029]/u;
const CO_AUTHOR = 'Co-authored-by';

/**
 * The author a commit may carry, from what an identity or a caller supplied. Undefined when there is none: no value, or
 * an empty name or email, since a provider needs both. A value that is not a name and an email in text, or that holds a
 * character of `UNSAFE`, is refused with a 400 `SourceError`: nothing is cleaned up, so a commit never names someone
 * other than whom the supplier wrote.
 */
export function commitAuthor(value: unknown, who = 'The commit author'): CommitAuthor | undefined {
  if (value === undefined || value === null) return undefined;
  const refuse = () => new SourceError(`${who}'s name or email cannot be written into a commit.`, 400);
  if (typeof value !== 'object' || Array.isArray(value)) throw refuse();
  const part = (text: unknown) => {
    if (text === undefined || text === null) return '';
    if (typeof text !== 'string' || UNSAFE.test(text)) throw refuse();
    return text.trim();
  };
  const { name, email } = value as { name?: unknown; email?: unknown; };
  const author = { name: part(name), email: part(email) };
  return author.name && author.email ? author : undefined;
}

/**
 * Names `coAuthors` in `Co-authored-by: Name <email>` trailers at the end of a commit message, in the order given.
 * A person is named once, by email whatever its case: the commit's `author`, someone the message's trailers already
 * name and a repeated entry are left out, so applying it again adds nothing. An entry without a name or email is
 * skipped, and one `commitAuthor` refuses is refused here too.
 */
export function withCoAuthors(message: string, coAuthors: readonly CommitAuthor[], author?: CommitAuthor): string {
  if (!Array.isArray(coAuthors)) throw new SourceError('Co-authors are a list of names and emails.', 400);
  const named = new Set<string>(author ? [author.email.toLowerCase()] : []);
  for (const line of trailerBlock(message.trimEnd())?.split('\n') ?? []) {
    const email = new RegExp(`^${CO_AUTHOR}: .*<([^<>]*)>\\s*$`, 'i').exec(line)?.[1];
    if (email) named.add(email.trim().toLowerCase());
  }
  const trailers: string[] = [];
  for (const entry of coAuthors) {
    const person = commitAuthor(entry, 'A co-author');
    if (!person || named.has(person.email.toLowerCase())) continue;
    named.add(person.email.toLowerCase());
    trailers.push(`${CO_AUTHOR}: ${person.name} <${person.email}>`);
  }
  return appendTrailers(message, trailers);
}
