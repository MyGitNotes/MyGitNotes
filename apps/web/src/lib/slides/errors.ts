/** What a slide note's deck is refused for: a slide directive contour-deck rejects, or a structure its rehype plugin cannot build. */
export class SlideDeckError extends Error {
  /** The 1-based line of the note's text the failure is on, when it is known. */
  constructor(message: string, readonly line?: number) {
    super(message);
    this.name = 'SlideDeckError';
  }
}

/** A slide note with nothing to show: its deck would have no slide. */
export class EmptyDeckError extends Error {
  constructor() {
    super('The note has no slides');
    this.name = 'EmptyDeckError';
  }
}
