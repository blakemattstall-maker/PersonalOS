import Link from "next/link";
import AlmanacMark from "./AlmanacMark.js";
import ProductFilm from "./ProductFilm.js";
import WaitlistForm from "./WaitlistForm.js";
import styles from "./launch.module.css";

export const metadata = {
  title: "Almanac — context for your whole life",
  description: "A private executive assistant that connects your calendar, tasks, notes, money, health, work and relationships — then acts across them from one request.",
  openGraph: {
    title: "Almanac — context for your whole life",
    description: "One request. Your full context. Finished work across the apps you already use.",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Almanac" }]
  }
};

const CAPABILITIES = [
  { verb: "Capture", title: "Say it before it disappears.", body: "Press the iPhone Action Button and speak. Almanac fixes relative dates, reads copied text only when you reference it, and files each part where it belongs.", signal: "VOICE · TEXT · CLIPBOARD" },
  { verb: "Understand", title: "Ask across the boundaries.", body: "Calendar, money, health, work, projects, notes and people become one connected history instead of seven isolated lists.", signal: "28 ROUTED TOOLS" },
  { verb: "Act", title: "Turn answers into finished work.", body: "Research the live web, create Calendar events and Tasks, write Google Docs, and prepare Gmail drafts for review—from one dependent request.", signal: "UP TO 6 DEPENDENT STEPS" },
  { verb: "Notice", title: "Hear about the few things that matter.", body: "A morning brief and scheduled detectors watch for conflicts, drift and overlooked commitments. Silence is the correct result on a quiet day.", signal: "ONE INTERRUPTION BUDGET" }
];

const SYSTEMS = ["iPhone Shortcuts", "Google Calendar", "Google Tasks", "Gmail", "Google Docs", "Canvas", "SimpleFIN", "Live web", "Web Push"];

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
          <p className={styles.heroBody}>Almanac connects the information scattered across your day, then turns one spoken request into research, decisions and finished work across the apps you already use.</p>
          <div className={styles.heroActions}>
            <a href="#film" className={styles.primaryCta}>Watch the system work <span>↓</span></a>
            <a href="#waitlist" className={styles.secondaryCta}>Join the private beta</a>
          </div>
          <dl className={styles.heroProof}>
            <div><dt>28</dt><dd>active tools</dd></div>
            <div><dt>532</dt><dd>automated tests</dd></div>
            <div><dt>~$7</dt><dd>monthly runtime</dd></div>
          </dl>
        </div>
        <div className={styles.heroInstrument} aria-hidden="true">
          <div className={styles.instrumentHalo} />
          <AlmanacMark />
          <span className={styles.instrumentReadout}>CONTEXT / CONNECTED</span>
        </div>
      </section>

      <section id="film" className={styles.filmSection}>
        <header className={styles.sectionHead}>
          <p className={styles.eyebrow}>THE PRODUCT FILM</p>
          <h2>One sentence enters.<br />A chain of work comes back.</h2>
          <p>Follow one copied role through current research, personal work history, a finished document, an email draft and a scheduled follow-up.</p>
        </header>
        <ProductFilm />
      </section>

      <section className={styles.capabilitySection}>
        <header className={styles.sectionHead}>
          <p className={styles.eyebrow}>THE OPERATING LOOP</p>
          <h2>Capture. Understand.<br />Act. Notice.</h2>
        </header>
        <div className={styles.capabilityGrid}>
          {CAPABILITIES.map((item, index) => (
            <article key={item.verb} className={styles.capabilityCard}>
              <div className={styles.cardIndex}>0{index + 1}</div>
              <p className={styles.cardVerb}>{item.verb}</p>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span>{item.signal}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.systemSection}>
        <div className={styles.systemIntro}>
          <p className={styles.eyebrow}>ONE REASONING LAYER</p>
          <h2>Your tools stop being separate rooms.</h2>
          <p>Almanac reads and acts through the products already holding your life. The intelligence lives in the connections between them.</p>
        </div>
        <div className={styles.systemMap}>
          <AlmanacMark />
          <div className={styles.systemList}>{SYSTEMS.map((system, index) => <span key={system}><b>{String(index + 1).padStart(2, "0")}</b>{system}</span>)}</div>
        </div>
      </section>

      <section className={styles.builderSection}>
        <p className={styles.eyebrow}>BUILT IN PUBLIC. OPERATED IN PRIVATE.</p>
        <blockquote>“I built Almanac for one demanding user—me. The private beta is the test of whether that system should become a product for anyone else.”</blockquote>
        <p className={styles.builderNote}>Built solo by Blake Stall · Running daily · Fictional data used in every public demonstration</p>
      </section>

      <section id="waitlist" className={styles.waitlistSection}>
        <div>
          <p className={styles.eyebrow}>EARLY ACCESS</p>
          <h2>Help decide what Almanac becomes next.</h2>
          <p>Almanac is not accepting public accounts yet. Join the waitlist for build notes, private previews and the first invitations.</p>
        </div>
        <WaitlistForm variant="launch" />
      </section>

      <footer className={styles.footer}>
        <div className={styles.brand}><AlmanacMark compact /><span>Almanac</span></div>
        <span>CONTEXT, WITH CONSEQUENCES.</span>
        <span>© {new Date().getFullYear()} BLAKE STALL</span>
      </footer>
    </main>
  );
}
