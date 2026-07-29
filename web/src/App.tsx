import { lazy, Suspense } from "react";

const GmPage = lazy(() => import("./pages/GmPage"));
const SpectatorPage = lazy(() => import("./pages/SpectatorPage"));

function LoadingScreen() {
  return (
    <main className="center-screen" aria-busy="true">
      <div className="loading-mark" aria-hidden="true" />
      <p>Загрузка AI-DND…</p>
    </main>
  );
}

export function App() {
  const page = window.location.pathname.endsWith("/spectator") ? <SpectatorPage /> : <GmPage />;

  return (
    <Suspense fallback={<LoadingScreen />}>{page}</Suspense>
  );
}
