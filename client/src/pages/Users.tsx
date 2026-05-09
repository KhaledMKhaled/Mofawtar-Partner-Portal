import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { Plus, Pencil } from "lucide-react";
import { useCurrentUser, can } from "../hooks/useAuth";

interface User {
  id: number;
  name: string;
  email: string;
  status: string;
  roleId: number;
  roleKey: string;
  roleNameEn: string;
  roleNameAr: string;
  partnerId: number | null;
  partnerName: string | null;
  teamLeaderId: number | null;
}

interface Role {
  id: number;
  key: string;
  nameEn: string;
  nameAr: string;
  scope: "company" | "partner";
}

interface Partner { id: number; name: string }

type UserStatus = "active" | "inactive";

interface UserForm {
  name: string;
  email: string;
  password: string;
  roleId: number;
  partnerId: number | null;
  teamLeaderId: number | null;
  status: UserStatus;
}

const PARTNER_ADMIN_ASSIGNABLE_ROLES = new Set([
  "partner_accountant",
  "team_leader",
  "sales",
]);

function asUserStatus(v: string): UserStatus {
  return v === "inactive" ? "inactive" : "active";
}

const blank: UserForm = {
  name: "",
  email: "",
  password: "",
  roleId: 0,
  partnerId: null,
  teamLeaderId: null,
  status: "active",
};

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users") });
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/api/roles") });
  const partnersQ = useQuery({
    queryKey: ["partners"],
    queryFn: () => api<Partner[]>("/api/partners"),
    enabled: me?.roleKey === "company_super_admin",
  });
  const tlQ = useQuery({
    queryKey: ["team-leaders", me?.partnerId],
    queryFn: () => api<{ id: number; name: string }[]>("/api/users/team-leaders"),
    enabled: !!me?.partnerId,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(blank);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => api("/api/users", { method: "POST", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api(`/api/users/${id}`, { method: "PATCH", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); },
  });

  const availableRoles = (rolesQ.data || []).filter((r) => {
    // Partner Admin may only assign Partner Accountant / Team Leader / Sales.
    if (me?.roleKey === "partner_admin") return PARTNER_ADMIN_ASSIGNABLE_ROLES.has(r.key);
    return true;
  });

  const onNew = () => {
    setEditing(null);
    setForm({ ...blank, roleId: availableRoles[0]?.id || 0, partnerId: me?.roleKey === "partner_admin" ? me.partnerId : null });
    setError(null);
    setOpen(true);
  };
  const onEdit = (u: User) => {
    setEditing(u);
    setForm({
      name: u.name, email: u.email, password: "",
      roleId: u.roleId, partnerId: u.partnerId, teamLeaderId: u.teamLeaderId,
      status: asUserStatus(u.status),
    });
    setError(null);
    setOpen(true);
  };
  const submit = async () => {
    setError(null);
    try {
      const data: Record<string, unknown> = { ...form };
      if (editing && !form.password) delete data.password;
      const role = availableRoles.find((r) => r.id === form.roleId);
      if (role?.scope === "company") data.partnerId = null;
      if (editing) await update.mutateAsync({ id: editing.id, data });
      else await create.mutateAsync(data);
    } catch (e) {
      const err = e as { body?: { error?: string }; message?: string };
      setError(err?.body?.error || err?.message || "failed");
    }
  };

  const selectedRole = availableRoles.find((r) => r.id === form.roleId);
  const showPartner = selectedRole?.scope === "partner" && me?.roleKey === "company_super_admin";
  const showTeamLeader = selectedRole?.key === "sales";
  const canCreate = can(me, "users:create");
  const canEdit = can(me, "users:edit");

  return (
    <div>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          canCreate && (
            <button className="btn-primary" onClick={onNew}>
              <Plus className="w-4 h-4" /> {t("users.new")}
            </button>
          )
        }
      />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.email")}</th>
              <th>{t("common.role")}</th>
              <th>{t("common.partner")}</th>
              <th>{t("common.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {usersQ.isLoading && <tr><td colSpan={6} className="text-center text-muted py-8">{t("common.loading")}</td></tr>}
            {usersQ.data?.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-8">{t("common.noData")}</td></tr>}
            {usersQ.data?.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}</td>
                <td className="font-mono text-xs" dir="ltr">{u.email}</td>
                <td><span className="pill-violet">{isAr ? u.roleNameAr : u.roleNameEn}</span></td>
                <td>{u.partnerName || t("users.none")}</td>
                <td>
                  <span className={u.status === "active" ? "pill-success" : "pill-muted"}>
                    {t(`common.${u.status}`)}
                  </span>
                </td>
                <td className="text-end">
                  {canEdit && (
                    <button className="btn-ghost" onClick={() => onEdit(u)}>
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
        onClose={() => setOpen(false)}
        title={editing ? `${t("common.edit")} — ${editing.name}` : t("users.new")}
        size="lg"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button className="btn-primary" disabled={create.isPending || update.isPending} onClick={submit}>
              {editing ? t("common.update") : t("common.create")}
            </button>
          </>
        }
      >
        {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}
        <div className="form-row">
          <Field label={t("common.name")} required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("common.email")} required>
            <input type="email" dir="ltr" className="input" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("common.password")} required={!editing} hint={editing ? "Leave blank to keep current" : "≥ 8 chars"}>
            <input type="password" dir="ltr" className="input" value={form.password}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label={t("common.role")} required>
            <select className="input" value={form.roleId}
              onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}>
              <option value={0}>—</option>
              {availableRoles.map((r) => (
                <option key={r.id} value={r.id}>{isAr ? r.nameAr : r.nameEn}</option>
              ))}
            </select>
          </Field>
          {showPartner && (
            <Field label={t("common.partner")} required>
              <select className="input" value={form.partnerId ?? ""}
                onChange={(e) => setForm({ ...form, partnerId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {partnersQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          {showTeamLeader && (tlQ.data?.length ?? 0) > 0 && (
            <Field label={t("users.teamLeader")}>
              <select className="input" value={form.teamLeaderId ?? ""}
                onChange={(e) => setForm({ ...form, teamLeaderId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {tlQ.data?.map((t2) => <option key={t2.id} value={t2.id}>{t2.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={t("common.status")}>
            <select className="input" value={form.status}
              onChange={(e) => setForm({ ...form, status: asUserStatus(e.target.value) })}>
              <option value="active">{t("common.active")}</option>
              <option value="inactive">{t("common.inactive")}</option>
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
