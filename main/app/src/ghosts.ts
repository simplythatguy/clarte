/**
 * Calibration's ghost trail (NAT-44, owner 2026-11-08): as the Cloud glides to the next point it
 * leaves traces of itself, and the traces fade out as they too move on to the next position. Kept
 * short and faint (owner: "less motion so it doesn't cause headaches"): five traces, the farthest
 * 110 ms behind, at most 30 % strength.
 *
 * The traces are after-images that follow the Cloud along the path it actually took, each a fixed
 * delay behind the one before (the nearest LAG ms behind, the farthest COUNT × LAG). The glide eases
 * out, so as it sets off the traces stretch back along the path, and as it slows they catch up,
 * close in on it and melt into it. Each one's strength follows how far it lags behind: none when it sits
 * on the Cloud, full once it trails by half an orb. Nearer traces are stronger and sharper, farther ones
 * fainter, a little smaller and softer, and only the nearest keep a visible face, so the trail reads
 * as one ghostly smear of the Cloud rather than a row of faces.
 *
 * A trace shows only once it has itself left the spot the Cloud set off from, fading in over its
 * first stretch of travel, so the traces still waiting to leave never pile up where the Cloud was.
 *
 * Each trace is the Cloud as it looked when it set off: a copy of its canvas's frame and its face,
 * frozen. Only transforms, opacity and blur change per frame, so the trail is cheap.
 */

/** How many traces, and how far behind each next one runs. */
const COUNT = 5;
const LAG = 22;
/** History kept: a little more than the farthest trace needs. */
const KEEP = COUNT * LAG + 120;
/** A trace reaches full strength when it trails the Cloud by this share of the orb's size. */
const FULL_AT = 0.6;

type Sample = { t: number; x: number; y: number; size: number };

export class GhostTrail {
  private readonly ghosts: HTMLDivElement[] = [];
  private history: Sample[] = [];
  private shown = false;
  private snapSize = 0;
  /** Where the Cloud set off from on this glide. */
  private origin: Sample | null = null;

  constructor(private readonly layer: HTMLElement) {
    for (let k = 0; k < COUNT; k++) {
      const g = document.createElement('div');
      g.className = 'guide-ghost';
      g.style.opacity = '0';
      // The farthest trace is drawn first, so nearer traces lie over it.
      layer.prepend(g);
      this.ghosts.push(g);
    }
  }

  dispose(): void {
    for (const g of this.ghosts) g.remove();
  }

  /** Copy the Cloud as it is now into every trace. */
  private snapshot(cloud: HTMLElement): void {
    const source = cloud.querySelector<HTMLCanvasElement>('canvas');
    if (!source || !source.width) return;
    this.snapSize = cloud.offsetWidth;
    this.ghosts.forEach((g, k) => {
      const copy = cloud.cloneNode(true) as HTMLElement;
      const face = copy.querySelector<HTMLElement>('.cloud-face');
      if (face) face.style.opacity = Math.pow(1 - k / COUNT, 8).toFixed(3);
      const frozen = document.createElement('canvas');
      frozen.className = source.className;
      frozen.width = source.width;
      frozen.height = source.height;
      frozen.getContext('2d')?.drawImage(source, 0, 0);
      copy.querySelector('canvas')?.replaceWith(frozen);
      for (const svg of copy.querySelectorAll('svg.sketch')) {
        svg.setAttribute('data-mode', 'still');
        svg.removeAttribute('data-alive');
        svg.removeAttribute('data-blink');
      }
      g.style.width = g.style.height = `${this.snapSize}px`;
      g.replaceChildren(copy);
    });
  }

  /** Where the Cloud was `ago` ms before `now`, along its recorded path. */
  private at(time: number): Sample {
    const h = this.history;
    if (time <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (time >= a.t) {
        const u = b.t === a.t ? 1 : (time - a.t) / (b.t - a.t);
        return { t: time, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, size: a.size + (b.size - a.size) * u };
      }
    }
    return h[h.length - 1];
  }

  /**
   * One frame: record where the Cloud is and place the traces behind it. `on` false hides them;
   * `strength` (0…1) scales them (GuideOrb keeps the return to the centre gentle).
   */
  frame(now: number, orb: HTMLElement, on: boolean, strength = 1): void {
    const cloud = orb.querySelector<HTMLElement>('.cloud');
    if (!cloud) return;
    const base = this.layer.getBoundingClientRect();
    const r = cloud.getBoundingClientRect();
    const here: Sample = { t: now, x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, size: r.width };
    this.history.push(here);
    while (this.history.length > 2 && this.history[1].t < now - KEEP) this.history.shift();

    if (!on) { this.hide(); return; }
    // A new glide: take a fresh likeness as it sets off.
    const behind = this.at(now - COUNT * LAG);
    const travelling = Math.hypot(here.x - behind.x, here.y - behind.y) > 1;
    if (!travelling) { this.hide(); return; }
    if (!this.shown) { this.snapshot(cloud); this.shown = true; this.origin = behind; }
    const origin = this.origin ?? behind;
    if (!this.snapSize) return;

    for (let k = 0; k < COUNT; k++) {
      const g = this.ghosts[k];
      const p = this.at(now - (k + 1) * LAG);
      const apart = Math.hypot(p.x - here.x, p.y - here.y);
      const presence = Math.min(1, apart / (p.size * FULL_AT));
      const left = Math.min(1, Math.hypot(p.x - origin.x, p.y - origin.y) / (p.size * 0.4));
      const rank = 1 - k / COUNT; // 1 nearest … 1/COUNT farthest
      const opacity = 0.3 * Math.pow(rank, 1.5) * presence * left * strength;
      const scale = (p.size / this.snapSize) * (1 - 0.02 * (k + 1));
      g.style.opacity = opacity.toFixed(3);
      g.style.transform = `translate(${(p.x - this.snapSize / 2).toFixed(1)}px, ${(p.y - this.snapSize / 2).toFixed(1)}px) scale(${scale.toFixed(4)})`;
      g.style.filter = k === 0 ? '' : `blur(${(0.25 * k).toFixed(2)}px)`;
    }
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.origin = null;
    for (const g of this.ghosts) g.style.opacity = '0';
  }
}
