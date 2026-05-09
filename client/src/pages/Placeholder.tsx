import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/AppShell";
import type { Module } from "@shared/permissions";
import { Construction } from "lucide-react";

export function PlaceholderPage({ moduleKey }: { moduleKey: Module }) {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t(`nav.${moduleKey}`)} />
      <div className="stamp-card p-12 text-center">
        <Construction className="w-12 h-12 text-violet mx-auto mb-3" />
        <h3 className="font-semibold text-ink mb-1">{t(`nav.${moduleKey}`)}</h3>
        <p className="text-sm text-muted">{t("common.comingSoon")}</p>
      </div>
    </div>
  );
}
