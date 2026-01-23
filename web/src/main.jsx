import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

registerSW({
  immediate: true,
  onRegistered(registration) {
    if (registration) {
      console.log("Service worker registered");
    }
  },
  onRegisterError(error) {
    console.error("Service worker registration failed", error);
  },
});
