import { SourceError } from './github-api.js';
import { appendTrailers } from './note-versions.js';

/** Who a commit names: its author, or a co-author in a `Co-authored-by` trailer. */
export interface CommitAuthor {
  name: string;
  email: string;
}

/**
 * What a name or email may not hold. Angle brackets delimit the email in a commit's author line and in a trailer, and a
 * line break ends either, so any of them could add an identity, a header or a trailer of the writer's choosing. Control
 * characters and the Unicode line separators go with them, and so do the bidirectional overrides and isolates and the
 * byte order mark, which change how a name reads without changing what it is. Joiners stay: some scripts write names with them.
 */
const UNSAFE = /[<>\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;
const CO_AUTHOR = 'Co-authored-by';
/** Longest name and email a commit names, and most co-authors one commit lists. */
const MAX_NAME = 256, MAX_EMAIL = 320, MAX_CO_AUTHORS = 50;
/** A line naming a co-author by the email in its last angle brackets; anchored at the line start, so a long line takes linear time. */
const CO_AUTHOR_LINE = new RegExp(`^${CO_AUTHOR}:.*<([^<>]*)>\\s*$`, 'i');

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
  if (author.name.length > MAX_NAME || author.email.length > MAX_EMAIL) throw refuse();
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
  if (coAuthors.length > MAX_CO_AUTHORS) throw new SourceError(`A commit names at most ${MAX_CO_AUTHORS} co-authors.`, 400);
  // Every commit passes here; one with no co-authors to add keeps its message unread.
  if (!coAuthors.length) return message;
  const named = new Set<string>(author ? [author.email.toLowerCase()] : []);
  // Any line of the message naming a co-author counts, whatever its line end, spacing or paragraph.
  for (const line of message.split(/\r?\n/)) {
    const email = CO_AUTHOR_LINE.exec(line)?.[1];
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
