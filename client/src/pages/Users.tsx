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
  teamLeaderName: string | null;
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
  const rolesQ = useQuery({ queryKey: ["assignable-roles"], queryFn: () => api<Role[]>("/api/roles/assignable") });
  // Load partners for any user without a fixed partner (i.e. company-scoped roles)
  const partnersQ = useQuery({
    queryKey: ["partners"],
    queryFn: () => api<Partner[]>("/api/partners"),
    enabled: !me?.partnerId,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(blank);
  const [error, setError] = useState<string | null>(null);

  // If the current user has a fixed partner (partner_admin, team_leader, sales)
  // use it directly; otherwise use whatever the form has selected.
  const tlPartnerId = me?.partnerId ?? form.partnerId;
  const tlQ = useQuery({
    queryKey: ["team-leaders", tlPartnerId],
    queryFn: () => api<{ id: number; name: string }[]>(`/api/users/team-leaders?partnerId=${tlPartnerId}`),
    enabled: !!tlPartnerId,
  });

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => api("/api/users", { method: "POST", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api(`/api/users/${id}`, { method: "PATCH", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); },
  });

  // Server already filters roles to what the current user may assign.
  const availableRoles = rolesQ.data || [];

  const onNew = () => {
    setEditing(null);
    const initPartnerId = me?.partnerId ?? null;
    const initTeamLeaderId = me?.roleKey === "team_leader" ? me.id : null;
    setForm({ ...blank, roleId: availableRoles[0]?.id || 0, partnerId: initPartnerId, teamLeaderId: initTeamLeaderId });
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
  // Show partner field for any user without a fixed partner (company-scoped roles).
  const showPartner = !me?.partnerId;
  // Partner is required when the chosen role is partner-scoped.
  const partnerRequired = selectedRole?.scope === "partner";
  // Show team leader whenever the sales role is selected — even before a partner
  // is chosen, so the user understands the dependency via the hint.
  const showTeamLeader = selectedRole?.key === "sales";
  const teamLeaderHint = !tlPartnerId
    ? t("users.selectPartnerFirst")
    : !tlQ.isLoading && (tlQ.data?.length ?? 0) === 0
      ? t("users.noTeamLeadersForPartner")
      : undefined;
  // If the current user is a team leader they can only assign themselves.
  const isTeamLeader = me?.roleKey === "team_leader";
  // Self-edit protection: cannot change own role or status.
  const isSelf = !!editing && editing.id === me?.id;
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
              <th>{t("users.teamLeader")}</th>
              <th>{t("common.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {usersQ.isLoading && <tr><td colSpan={7} className="text-center text-muted py-8">{t("common.loading")}</td></tr>}
            {usersQ.data?.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-8">{t("common.noData")}</td></tr>}
            {usersQ.data?.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}</td>
                <td className="font-mono text-xs" dir="ltr">{u.email}</td>
                <td><span className="pill-violet">{isAr ? u.roleNameAr : u.roleNameEn}</span></td>
                <td>{u.partnerName || t("users.none")}</td>
                <td>{u.teamLeaderName || t("users.none")}</td>
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
          <Field label={t("common.password")} required={!editing} hint={editing ? t("common.leaveBlankToKeep") : t("common.minChars", { n: 8 })}>
            <input type="password" dir="ltr" className="input" value={form.password}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label={t("common.role")} required hint={isSelf ? t("users.cannotEditOwnRole") : undefined}>
            <select className="input" value={form.roleId} disabled={isSelf}
              onChange={(e) => {
                const newRoleId = Number(e.target.value);
                const newRole = availableRoles.find((r) => r.id === newRoleId);
                const nextTeamLeaderId = newRole?.key === "sales" && isTeamLeader
                  ? (me?.id ?? null)
                  : null;
                setForm({ ...form, roleId: newRoleId, teamLeaderId: nextTeamLeaderId });
              }}>
              <option value={0}>—</option>
              {availableRoles.map((r) => (
                <option key={r.id} value={r.id}>{isAr ? r.nameAr : r.nameEn}</option>
              ))}
            </select>
          </Field>
          {showPartner && (
            <Field label={t("common.partner")} required={partnerRequired}>
              <select className="input" value={form.partnerId ?? ""}
                onChange={(e) => setForm({ ...form, partnerId: e.target.value ? Number(e.target.value) : null, teamLeaderId: null })}>
                <option value="">—</option>
                {partnersQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          {showTeamLeader && (
            <Field label={t("users.teamLeader")} hint={teamLeaderHint}>
              {isTeamLeader ? (
                // Team leaders can only assign themselves — show their name read-only.
                <input className="input bg-gray-50 cursor-not-allowed" value={me?.name ?? ""} disabled readOnly />
              ) : (
                <select
                  className="input"
                  value={form.teamLeaderId ?? ""}
                  onChange={(e) => setForm({ ...form, teamLeaderId: e.target.value ? Number(e.target.value) : null })}
                  disabled={!tlPartnerId || tlQ.isLoading}
                >
                  <option value="">{tlQ.isLoading ? t("common.loading") : "—"}</option>
                  {tlQ.data?.map((t2) => <option key={t2.id} value={t2.id}>{t2.name}</option>)}
                </select>
              )}
            </Field>
          )}
          <Field label={t("common.status")} hint={isSelf ? t("users.cannotEditOwnStatus") : undefined}>
            <select className="input" value={form.status} disabled={isSelf}
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
