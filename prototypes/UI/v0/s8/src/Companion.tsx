/**
 * The companion in the middle of the conversation (owner, 2026-11-08): the reference mesh-gradient
 * character (components/ui/shader-svg.tsx), exactly as given, in place of the Cloud. It is there
 * only while the middle is blank; as soon as text appears there (words heard, the message typed,
 * the sentence being spoken, a menu title) it fades, and it returns when the text is gone.
 *
 * "Still" (the Motion setting) and the system's reduced-motion preference stop its bob and blink.
 */
import { MotionConfig } from 'framer-motion';
import { MeshGradientSVG } from '@/components/ui/shader-svg';

type Props = {
  /** The middle is blank: no live text and no title there. */
  visible: boolean;
  still: boolean;
};

export function Companion({ visible, still }: Props) {
  return (
    <div className="companion" data-hidden={visible ? undefined : ''} data-still={still ? '' : undefined} aria-hidden="true">
      <div className="companion-body">
        <MotionConfig reducedMotion={still ? 'always' : 'user'}>
          <MeshGradientSVG />
        </MotionConfig>
      </div>
    </div>
  );
}
