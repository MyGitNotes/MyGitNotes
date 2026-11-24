/** jsdom implements dialog state, not the top-layer API. */
export function stubModalDialog() {
  HTMLDialogElement.prototype.showModal ??= function(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function(this: HTMLDialogElement) {
    this.open = false;
  };
}
