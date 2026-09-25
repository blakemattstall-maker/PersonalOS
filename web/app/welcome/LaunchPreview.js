import AlmanacMark from "./AlmanacMark.js";
import styles from "./launch.module.css";

export default function LaunchPreview() {
  return (
    <div className={styles.filmFrame} aria-label="Illustrated Almanac workflow using sample data">
      <div className={styles.filmChrome}>
        <div className={styles.filmLights} aria-hidden="true"><i /><i /><i /></div>
        <span>ALMANAC / DEMO SEQUENCE / SAMPLE DATA</span>
        <span>01:18</span>
      </div>
      <div className={styles.filmCanvas}>
        <div className={styles.captureRail}>
          <div className={styles.phoneButton} aria-hidden="true"><AlmanacMark compact /></div>
          <div><span className={styles.signalLabel}>ACTION BUTTON</span><p>Clipboard attached</p></div>
        </div>
        <blockquote className={styles.voiceLine}>
          “Research this role, compare it with my work history, build an interview brief, draft the email, and remind me to rehearse Friday.”
        </blockquote>
        <div className={styles.routeLine} aria-hidden="true">
          <span>WEB</span><i /><span>WORK LOG</span><i /><span>DOCS</span><i /><span>GMAIL</span><i /><span>TASKS</span>
        </div>
        <div className={styles.resultStack}>
          <div><span>01</span><strong>Research complete</strong><small>8 current sources checked</small></div>
          <div><span>02</span><strong>Interview brief created</strong><small>Google Doc · 6 sections</small></div>
          <div><span>03</span><strong>Email drafted</strong><small>Gmail · held for review</small></div>
          <div><span>04</span><strong>Practice scheduled</strong><small>Friday · Google Tasks</small></div>
        </div>
      </div>
      <div className={styles.filmFooter}>
        <span>One request</span><span>Four finished outputs</span><span>Nothing sent without review</span>
      </div>
    </div>
  );
}
