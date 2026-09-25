import { existsSync } from "node:fs";
import { join } from "node:path";
import LaunchPreview from "./LaunchPreview.js";
import styles from "./launch.module.css";

// The launch page is complete before the final edit exists. Dropping the film
// at public/almanac-demo.mp4 and redeploying replaces the motion storyboard
// automatically; no page rewrite or feature flag is required.
export default function ProductFilm() {
  const hasFilm = existsSync(join(process.cwd(), "public", "almanac-demo.mp4"));
  if (!hasFilm) return <LaunchPreview />;

  return (
    <div className={styles.videoFrame}>
      <video controls playsInline preload="metadata" aria-label="Almanac product film">
        <source src="/almanac-demo.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
