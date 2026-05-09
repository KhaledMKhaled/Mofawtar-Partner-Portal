import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { en } from "./locales/en";
import { ar } from "./locales/ar";

// Arabic (RTL) is the product default. We honour an explicit language saved
// in localStorage (the user's previous toggle), but we never auto-detect from
// the browser — that's how an English browser was previously overriding the
// product default on first load.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: "ar",
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
