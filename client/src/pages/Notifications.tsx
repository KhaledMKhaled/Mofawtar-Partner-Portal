import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";

interface N {
  id: number;
  type: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string | null;
  bodyAr: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const qc = useQueryClient();
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<N[]>("/api/notifications"),
  });
  const readAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const readOne = useMutation({
    mutationFn: (id: number) => api(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div>
      <PageHeader
        title={t("nav.notifications")}
        subtitle={t("notifications.subtitle")}
        actions={
          <button className="btn-outline" onClick={() => readAll.mutate()}>
            {t("notifications.markAllRead")}
          </button>
        }
      />
      <div className="stamp-card overflow-hidden">
        {list.data?.length === 0 && <div className="p-8 text-center text-muted">{t("common.noData")}</div>}
        {list.data?.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              if (!n.readAt) readOne.mutate(n.id);
              if (n.linkPath) nav(n.linkPath);
            }}
            className={"w-full text-start px-5 py-4 border-b border-border/70 last:border-b-0 hover:bg-magnolia/40 flex items-start gap-3 " + (n.readAt ? "opacity-60" : "")}
          >
            <div className={"mt-1 w-2 h-2 rounded-full " + (n.readAt ? "bg-slate-300" : "bg-violet")} />
            <div className="flex-1">
              <div className="font-medium text-sm">{isAr ? n.titleAr : n.titleEn}</div>
              {(isAr ? n.bodyAr : n.bodyEn) && <div className="text-xs text-muted mt-0.5">{isAr ? n.bodyAr : n.bodyEn}</div>}
            </div>
            <div className="text-xs text-muted whitespace-nowrap">{new Date(n.createdAt).toLocaleString(isAr ? "ar" : "en")}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
