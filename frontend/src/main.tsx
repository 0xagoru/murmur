import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { api, type Config } from "./api";
import "./style.css";
import "./features.css";
const App = lazy(() => import("./App"));
const Auth = lazy(() => import("./Auth"));
function Boot() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Config>("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <main className="boot">
        <h1>murmur</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  return (
    <Suspense fallback={null}>
      {config ? (
        <Auth config={config}>
          <App config={config} />
        </Auth>
      ) : null}
    </Suspense>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>,
);
