import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { en } from "./locales/en";
import { ar } from "./locales/ar";

// Read language from localStorage so a previously-saved setting persists across
// page reloads. Fall back to Arabic (the product default) when nothing is stored.
// We never auto-detect from the browser locale to avoid an English browser
// overriding the Arabic product default on first load.
const storedLang = localStorage.getItem("i18nextLng");
const initialLang = storedLang === "en" ? "en" : "ar";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: initialLang,
    fallbackLng: "ar",
    supportedLngs: ["ar", "en"],
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage"], caches: ["localStorage"] },
  });

function applyDirection(lng: string) {
  const dir = lng.startsWith("ar") ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
}

applyDirection(i18n.language || "ar");
i18n.on("languageChanged", applyDirection);

export default i18n;
