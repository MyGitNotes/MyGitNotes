import type { AnnotateController } from './controller.js';

const controllers = new WeakMap<Element, AnnotateController>();

/** The controller that owns the live-editor widget element `dom`. A module of its own so the image preview can ask for it without loading the editor. */
export function registerController(dom: Element, controller: AnnotateController): void {
  controllers.set(dom, controller);
}

export function forgetController(dom: Element): void {
  controllers.delete(dom);
}

export function controllerOf(dom: Element | null): AnnotateController | undefined {
  return dom ? controllers.get(dom) : undefined;
}
