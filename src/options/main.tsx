import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { App } from "./App";
import { ToastProvider } from "../ui/toasts";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}
