import Link from "next/link";
import SettingsPanel from "../SettingsPanel.js";
import { backendGet } from "../backend.js";


export const dynamic = "force-dynamic";


async function safeGet(path, fallback) {

  try {

    return await backendGet(path);

  } catch (error) {

    return fallback;

  }

}


export default async function Settings() {

  const [settings, diagnostics] = await Promise.all([
    safeGet("/api/settings", { settings: null }),
    safeGet("/api/diag", { success: false })
  ]);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Back
          </Link>
        </div>

        <SettingsPanel
          initialSettings={settings?.settings || null}
          initialDiagnostics={diagnostics}
        />

      </main>
    </div>
  );

}
