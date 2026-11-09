/**
 * Content that cross-fades in place when its key changes. On a page change it follows MOTION's
 * "Phase or page change" (out 150 ms, in 300 ms from 100 ms). `fast` marks a change within one
 * screen, such as the candidate word while typing: a frequent action, so it uses the 150 ms label
 * cross-fade with no entrance delay (BRIEF: frequent actions take at most 150 ms).
 *
 * The outgoing copy is a clone of the DOM that was on screen, taken just before React replaces
 * it, with every computed font size frozen inline. A re-render of the old content would lose the
 * sizes the card's fit pass set, so the fading copy would jump on its first frame.
 */
import { Component, createRef, type ReactNode } from 'react';

type Props = { swapKey: string; className: string; leavingClass: string; fast?: boolean; children: ReactNode };

const LIFETIME = 170;

function freeze(el: HTMLElement, leavingClass: string, fast: boolean): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')];
  const to = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  from.forEach((node, i) => { to[i].style.fontSize = getComputedStyle(node).fontSize; });
  clone.classList.add(leavingClass);
  clone.toggleAttribute('data-fast', fast);
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  return clone;
}

export class Swap extends Component<Props> {
  private node = createRef<HTMLSpanElement>();

  getSnapshotBeforeUpdate(prev: Props): HTMLElement | null {
    const el = this.node.current;
    return el && prev.swapKey !== this.props.swapKey ? freeze(el, this.props.leavingClass, Boolean(this.props.fast)) : null;
  }

  componentDidUpdate(_prev: Props, _state: unknown, leaving: HTMLElement | null): void {
    const el = this.node.current;
    if (!leaving || !el?.parentNode) return;
    el.parentNode.insertBefore(leaving, el);
    window.setTimeout(() => leaving.remove(), LIFETIME);
  }

  render() {
    return <span key={this.props.swapKey} ref={this.node} className={this.props.className} data-fast={this.props.fast || undefined}>{this.props.children}</span>;
  }
}
