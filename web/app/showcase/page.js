import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { showcaseSession } from "../../lib/demo.js";

export const metadata = { title: "Almanac Showcase", robots: { index: false, follow: false } };

async function enterShowcase(formData) {
  "use server";
  const supplied = String(formData.get("passphrase") || "");
  const ownerPassphrase = process.env.SITE_PASSPHRASE;
  if (!ownerPassphrase || supplied !== ownerPassphrase) redirect("/showcase?error=1");

  const store = await cookies();
  store.set("pos_session", showcaseSession(ownerPassphrase), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 2
  });
  redirect("/");
}

export default async function ShowcasePage({ searchParams }) {
  const params = await searchParams;
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-[#080d10] px-6 py-16 text-[#f4f3ed]">
      <div className="w-full max-w-md">
        <p className="pos-data text-[0.68rem] tracking-[0.12em] text-[#8fe0c1]">PRIVATE RECORDING WORKSPACE</p>
        <h1 className="pos-display mt-4 text-[3rem] leading-[0.92]">Enter the fictional Almanac.</h1>
        <p className="mt-5 text-[0.92rem] leading-relaxed text-[#92a1a4]">This opens the real interface on a coherent sample life. It cannot read personal data or perform writes, and it expires after two hours.</p>
        <form action={enterShowcase} className="mt-8">
          <input type="password" name="passphrase" required autoFocus aria-label="Owner passphrase" placeholder="Owner passphrase" className="w-full rounded-[999px] border border-white/15 bg-white/5 px-5 py-3.5 text-[#f4f3ed] outline-none placeholder:text-[#718084] focus:border-[#8fe0c1]" />
          {params?.error === "1" && <p className="mt-3 text-sm text-[#ff9b7d]">That passphrase did not unlock the showcase.</p>}
          <button className="mt-4 w-full rounded-[999px] bg-[#8fe0c1] px-5 py-3.5 font-semibold text-[#07100e]">Open fictional workspace</button>
        </form>
        <Link href="/welcome" className="mt-6 inline-block text-sm text-[#92a1a4] underline decoration-white/20 underline-offset-4">Back to the public page</Link>
      </div>
    </main>
  );
}
