import { cookies } from "next/headers";
import { redirect } from "next/navigation";


async function login(formData) {
  "use server";

  const passphrase = formData.get("passphrase");

  if (passphrase === process.env.SITE_PASSPHRASE) {

    const cookieStore = await cookies();

    cookieStore.set("pos_session", process.env.SITE_PASSPHRASE, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180
    });

    redirect("/");
  }

  redirect("/login?error=1");
}


export default async function LoginPage({ searchParams }) {

  const params = await searchParams;
  const hasError = params?.error === "1";

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <form action={login} className="w-full max-w-sm space-y-4">

        <h1 className="text-xl font-semibold text-foreground">PersonalOS</h1>

        <p className="text-sm text-muted">Enter your passphrase to continue.</p>

        <input
          type="password"
          name="passphrase"
          autoFocus
          required
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-foreground outline-none focus:border-accent"
          placeholder="Passphrase"
        />

        {hasError && (
          <p className="text-sm text-red-500">That wasn't right — try again.</p>
        )}

        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-white"
        >
          Unlock
        </button>

      </form>
    </div>
  );

}
