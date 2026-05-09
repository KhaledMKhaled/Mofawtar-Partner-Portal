import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { Plus, Pencil, Lock } from "lucide-react";
import { useCurrentUser, can } from "../hooks/useAuth";

interface Role {
  id: number;
  key: string;
  nameEn: string;
  nameAr: string;
  scope: "company" | "partner";
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

interface Meta {
  modules: string[];
  actions: string[];
}

export function RolesPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/api/roles") });
  const metaQ = useQuery({ queryKey: ["roles-meta"], queryFn: () => api<Meta>("/api/roles/meta") });
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ key: "", nameEn: "", nameAr: "", scope: "company" as "company" | "partner", permissions: [] as string[] });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: any) => api("/api/roles", { method: "POST", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); close(); },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api(`/api/roles/${id}`, { method: "PATCH", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); close(); },
  });

  const open = !!editing || creating;
  const close = () => { setEditing(null); setCreating(false); setError(null); };

  const onEdit = (r: Role) => {
    setEditing(r);
    setForm({ key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, scope: r.scope, permissions: r.permissions || [] });
  };
  const onNew = () => {
    setCreating(true);
    setForm({ key: "", nameEn: "", nameAr: "", scope: "company", permissions: [] });
  };
  const submit = async () => {
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: form });
      } else {
        await create.mutateAsync(form);
      }
    } catch (e: any) {
      setError(e?.body?.error || e?.message || "failed");
    }
  };

  const togglePerm = (p: string) => {
    setForm((f) =>
      f.permissions.includes(p)
        ? { ...f, permissions: f.permissions.filter((x) => x !== p) }
        : { ...f, permissions: [...f.permissions, p] }
    );
  };
  const toggleModule = (mod: string) => {
    if (!metaQ.data) return;
    const all = metaQ.data.actions.map((a) => `${mod}:${a}`);
    const allOn = all.every((p) => form.permissions.includes(p));
    setForm((f) => ({
      ...f,
      permissions: allOn
        ? f.permissions.filter((p) => !all.includes(p))
        : Array.from(new Set([...f.permissions, ...all])),
    }));
  };

  const canEdit = can(user, "roles:edit");
  const canCreate = can(user, "roles:create");

  return (
    <div>
      <PageHeader
        title={t("roles.title")}
        subtitle={t("roles.subtitle")}
        actions={canCreate && <button className="btn-primary" onClick={onNew}><Plus className="w-4 h-4" /> {t("roles.new")}</button>}
      />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("roles.scope")}</th>
              <th>{t("roles.userCount")}</th>
              <th>{t("roles.permissions")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rolesQ.data?.map((r) => (
              <tr key={r.id}>
                <td className="font-medium flex items-center gap-2">
                  {isAr ? r.nameAr : r.nameEn}
                  {r.isSystem && <Lock className="w-3.5 h-3.5 text-muted" />}
                </td>
                <td><span className="pill-violet">{r.scope === "company" ? t("roles.company") : t("roles.partnerScope")}</span></td>
                <td>{r.userCount}</td>
                <td className="text-xs text-muted">{r.permissions?.length || 0} permissions</td>
                <td className="text-end">
                  {canEdit && (
                    <button className="btn-ghost" onClick={() => onEdit(r)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={close}
        title={editing ? `${t("common.edit")} — ${isAr ? editing.nameAr : editing.nameEn}` : t("roles.new")}
        size="xl"
        footer={
          <>
            <button className="btn-outline" onClick={close}>{t("common.cancel")}</button>
            <button className="btn-primary" disabled={create.isPending || update.isPending} onClick={submit}>
              {editing ? t("common.update") : t("common.create")}
            </button>
          </>
        }
      >
        {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}
        <div className="form-row">
          <Field label={t("roles.nameEn")} required>
            <input className="input" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Field>
          <Field label={t("roles.nameAr")} required>
            <input className="input" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          </Field>
          <Field label={t("roles.key")} required>
            <input className="input font-mono" disabled={editing?.isSystem} value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })} />
          </Field>
          <Field label={t("roles.scope")}>
            <select className="input" disabled={editing?.isSystem} value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as any })}>
              <option value="company">{t("roles.company")}</option>
              <option value="partner">{t("roles.partnerScope")}</option>
            </select>
          </Field>
        </div>

        <div className="mt-6">
          <div className="dashed-divider mb-4" />
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("roles.permissions")}</h3>
          <PermissionsMatrix meta={metaQ.data} permissions={form.permissions} onToggle={togglePerm} onToggleModule={toggleModule} />
        </div>
      </Modal>
    </div>
  );
}

function PermissionsMatrix({
  meta,
  permissions,
  onToggle,
  onToggleModule,
}: {
  meta?: Meta;
  permissions: string[];
  onToggle: (p: string) => void;
  onToggleModule: (m: string) => void;
}) {
  const { t } = useTranslation();
  if (!meta) return <div className="text-muted text-sm">{t("common.loading")}</div>;
  const set = useMemo(() => new Set(permissions), [permissions]);
  return (
    <div className="overflow-x-auto stamp-card">
      <table className="table text-xs">
        <thead>
          <tr>
            <th className="sticky start-0 bg-magnolia/60">Module</th>
            {meta.actions.map((a) => <th key={a} className="text-center">{a}</th>)}
          </tr>
        </thead>
        <tbody>
          {meta.modules.map((mod) => (
            <tr key={mod}>
              <td className="font-medium">
                <button
                  type="button"
                  className="text-violet-700 hover:underline"
                  onClick={() => onToggleModule(mod)}
                >
                  {t(`nav.${mod}` as any, { defaultValue: mod })}
                </button>
              </td>
              {meta.actions.map((act) => {
                const key = `${mod}:${act}`;
                return (
                  <td key={act} className="text-center">
                    <input
                      type="checkbox"
                      checked={set.has(key)}
                      onChange={() => onToggle(key)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
