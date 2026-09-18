import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/500.css";
import "@fontsource/roboto-mono/700.css";
import "@fontsource/roboto-mono/400-italic.css";
import "@fontsource/sarabun/400.css";
import "@fontsource/sarabun/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "./styles/app.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
