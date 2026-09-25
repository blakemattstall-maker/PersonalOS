import Link from "next/link";
import AlmanacMark from "./AlmanacMark.js";
import ProductFilm from "./ProductFilm.js";
import WaitlistForm from "./WaitlistForm.js";
import styles from "./launch.module.css";

export const metadata = {
  title: "Almanac — context for your whole life",
  description: "One request. Your full context. Finished work across the apps you already use."
};

const CAPABILITIES = [
  ["Capture", "Voice, text and referenced clipboard content file themselves."],
  ["Understand", "Calendar, money, health, work, projects, notes and people share context."],
  ["Act", "Research, Docs, Gmail drafts, Calendar and Tasks run as one dependent chain."],
  ["Notice", "Briefs and detectors surface useful drift, then stay quiet when nothing matters."]
];

const SYSTEMS = ["iPhone Shortcuts", "Google Calendar", "Google Tasks", "Gmail", "Google Docs", "SimpleFIN", "Live web", "Web Push"];

export default function Welcome() {
  return (
    <main className={styles.launch}>
      <nav className={styles.nav} aria-label="Public navigation">
        <a href="#top" className={styles.brand} aria-label="Almanac home"><AlmanacMark compact /><span>Almanac</span></a>
        <div className={styles.navMeta}><span>PRIVATE BETA</span><Link href="/login">Owner sign in</Link></div>
      </nav>

      <section id="top" className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>A PERSONAL CONTEXT ENGINE</p>
          <h1>Your life has context.<br /><em>Your software should too.</em></h1>
          <p className={styles.heroBody}>Almanac connects the information scattered across your day, then turns one spoken request into research, decisions and finished work.</p>
          <div className={styles.heroActions}>
            <a href="#waitlist" className={styles.primaryCta}>Join the private beta</a>
            <span className={styles.proof}>28 tools · 532 tests · built solo</span>
          </div>
        </div>
        <div id="film" className={styles.heroFilm}><ProductFilm /></div>
      </section>

      <section className={styles.capabilitySection}>
        <header className={styles.compactHead}>
          <div><p className={styles.eyebrow}>THE OPERATING LOOP</p><h2>Capture. Understand. Act. Notice.</h2></div>
          <p>One reasoning layer across the tools already holding your life.</p>
        </header>
        <div className={styles.capabilityGrid}>
          {CAPABILITIES.map(([title, body], index) => (
            <article key={title} className={styles.capabilityCard}>
              <span>0{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section id="waitlist" className={styles.finalSection}>
        <div className={styles.systemBlock}>
          <p className={styles.eyebrow}>CONNECTED SYSTEMS</p>
          <div className={styles.systemLine}><AlmanacMark compact /><p>{SYSTEMS.join(" · ")}</p></div>
          <small>Every public demonstration uses fictional data.</small>
        </div>
        <div className={styles.waitlistBlock}>
          <h2>See what one connected life can do.</h2>
          <p>Almanac is not accepting public accounts yet. Join for build notes, private previews and the first invitations.</p>
          <WaitlistForm variant="launch" />
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.brand}><AlmanacMark compact /><span>Almanac</span></div>
        <span>© {new Date().getFullYear()} BLAKE STALL</span>
      </footer>
    </main>
  );
}
