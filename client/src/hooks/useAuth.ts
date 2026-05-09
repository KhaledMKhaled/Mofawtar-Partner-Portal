import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { Module, Permission } from "@shared/permissions";

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  imageUrl: string | null;
  roleId: number;
  roleKey: string;
  roleNameEn: string;
  roleNameAr: string;
  permissions: string[];
  partnerId: number | null;
  partnerName: string | null;
  status: string;
}

export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<CurrentUser>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api<CurrentUser>("/api/auth/login", { method: "POST", json: vars }),
    onSuccess: (data) => qc.setQueryData(["me"], data),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      qc.clear();
    },
  });
}

export function can(user: CurrentUser | null | undefined, perm: Permission | Permission[]) {
  if (!user) return false;
  const arr = Array.isArray(perm) ? perm : [perm];
  return arr.every((p) => user.permissions.includes(p));
}

export function canModule(user: CurrentUser | null | undefined, module: Module) {
  return can(user, `${module}:view` as Permission);
}
