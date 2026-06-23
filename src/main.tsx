import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import ShowerApp from "../app/shower-app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShowerApp />
  </StrictMode>
);
