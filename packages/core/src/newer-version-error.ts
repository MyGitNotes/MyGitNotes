/** A stored workspace document written by a newer version of the app than this deployment understands. */
export class NewerVersionError extends Error {
  constructor(label: string) {
    super(`This ${label} file was saved by a newer MyGitNotes; update this deployment.`);
  }
}
