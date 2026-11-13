// src/pages/AdminPages.tsx
import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Search,
  Download,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Building2,
  UserPlus,
  Trash2,
  Copy,
  Check,
  Filter,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { AuditLogItem, Role, UserProfile } from '../types/domain';
import {
  ConfirmDialog,
  InlineAlert,
  Skeleton,
  EmptyState,
} from '../components/shared/Primitives';
import { Interactive3DCard } from '../components/shared/Interactive3DCard';

// S12: Team & Roles Page
export const TeamPage: React.FC = () => {
  const { user, pushToast } = useApp();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');

  // Add Member Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('creator');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);

  // Role Change Dialog State
  const [pendingChange, setPendingChange] = useState<{
    memberId: string;
    memberName: string;
    newRole: Role;
  } | null>(null);

  // Remove Member Dialog State
  const [pendingDelete, setPendingDelete] = useState<{
    memberId: string;
    memberName: string;
    email: string;
  } | null>(null);

  const loadMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getMembers(user || undefined);
      setMembers(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [user?.org_id]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newName.trim() || !newEmail.trim()) {
      setAddError('Please enter both member name and work email address.');
      return;
    }
    setAddError(null);
    setIsSubmittingAdd(true);
    try {
      const updated = await api.addMember(user, {
        display_name: newName.trim(),
        email: newEmail.trim(),
        role: newRole,
        password: newPassword.trim() || 'Password123!',
      });
      setMembers(updated);
      pushToast({
        title: 'Team member added',
        description: `Successfully provisioned ${newName.trim()} (${newRole.toUpperCase()})`,
        type: 'success',
      });
      setIsAddModalOpen(false);
      setNewName('');
      setNewEmail('');
      setNewRole('creator');
      setNewPassword('');
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Failed to add team member');
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  const handleRoleConfirm = async () => {
    if (!user || !pendingChange) return;
    try {
      const updated = await api.updateMemberRole(
        user,
        pendingChange.memberId,
        pendingChange.newRole
      );
      setMembers(updated);
      pushToast({
        title: 'Role updated',
        description: `${pendingChange.memberName} is now ${pendingChange.newRole.toUpperCase()}`,
        type: 'success',
      });
      setPendingChange(null);
    } catch (err: unknown) {
      pushToast({
        title: 'Cannot change role',
        description: err instanceof Error ? err.message : 'Operation blocked',
        type: 'error',
      });
      setPendingChange(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!user || !pendingDelete) return;
    try {
      const updated = await api.removeMember(user, pendingDelete.memberId);
      setMembers(updated);
      pushToast({
        title: 'Member removed',
        description: `${pendingDelete.memberName} was removed from the workspace`,
        type: 'info',
      });
      setPendingDelete(null);
    } catch (err: unknown) {
      pushToast({
        title: 'Cannot remove member',
        description: err instanceof Error ? err.message : 'Action failed',
        type: 'error',
      });
      setPendingDelete(null);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.display_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header with Title, Active Org & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-normal text-[#282828] dark:text-[#fbf1c7] tracking-tight">
              Team & Role Authority
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#edeae1] dark:bg-[#32302f] text-[#4a4440] dark:text-[#ebdbb2] border border-[#e2ded5] dark:border-[#3c3836] shadow-2xs">
              <Building2 className="w-3.5 h-3.5 text-blue-500" />
              <span>Workspace: {user?.org_name || 'Organization'}</span>
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#5c5650] dark:text-[#d5c4a1] mt-1">
            Manage editorial permissions, reviewer gates, and organization team members.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddError(null);
            setIsAddModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-sans font-semibold text-white dark:text-[#1d2021] bg-[#1d6f7a] hover:bg-[#15545c] dark:bg-[#4ea8a0] dark:hover:bg-[#5ab8ad] transition-all shadow-xs tap-interactive cursor-pointer self-start sm:self-auto active:scale-[0.98]"
        >
          <UserPlus className="w-4 h-4" />
          <span>Provision Member</span>
        </button>
      </div>

      {/* Role Definitions Matrix (Bento Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-6 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] bg-white/95 dark:bg-[#32302f]/90 h-full flex flex-col justify-between text-xs shadow-sm hover:shadow-md transition-all">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1d6f7a] dark:bg-[#4ea8a0]" />
                <h3 className="font-serif text-base font-bold text-[#282828] dark:text-[#f5f5f4]">
                  Creator Role
                </h3>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#1d6f7a]/15 text-[#1d6f7a] dark:text-[#4ea8a0] font-sans font-semibold border border-[#1d6f7a]/30">
                Author
              </span>
            </div>
            <p className="text-xs text-[#504945] dark:text-[#d6d4ce] leading-relaxed font-sans">
              Draft content, run automated guideline & policy checks in real time, apply rule suggestions, and submit copy for approval.
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60 flex items-center gap-1.5 text-[11px] font-sans font-medium text-[#1d6f7a] dark:text-[#4ea8a0]">
            <Check className="w-3.5 h-3.5 text-[#1d6f7a] dark:text-[#4ea8a0] shrink-0" />
            <span>Drafting & preflight checks</span>
          </div>
        </div>

        <div className="p-6 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] bg-white/95 dark:bg-[#32302f]/90 h-full flex flex-col justify-between text-xs shadow-sm hover:shadow-md transition-all">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#627520] dark:bg-[#b8bb26]" />
                <h3 className="font-serif text-base font-bold text-[#282828] dark:text-[#f5f5f4]">
                  Reviewer Role
                </h3>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#627520]/15 text-[#627520] dark:text-[#b8bb26] font-sans font-semibold border border-[#627520]/30">
                Reviewer
              </span>
            </div>
            <p className="text-xs text-[#504945] dark:text-[#d6d4ce] leading-relaxed font-sans">
              Review queue submissions, evaluate policy findings, override exceptions with reason, and issue binding approvals.
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60 flex items-center gap-1.5 text-[11px] font-sans font-medium text-[#627520] dark:text-[#b8bb26]">
            <Check className="w-3.5 h-3.5 text-[#627520] dark:text-[#b8bb26] shrink-0" />
            <span>Approval authority & overrides</span>
          </div>
        </div>

        <div className="p-6 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] bg-white/95 dark:bg-[#32302f]/90 h-full flex flex-col justify-between text-xs shadow-sm hover:shadow-md transition-all">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#af3a03] dark:bg-[#fe8019]" />
                <h3 className="font-serif text-base font-bold text-[#282828] dark:text-[#f5f5f4]">
                  Admin Role
                </h3>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#af3a03]/15 text-[#af3a03] dark:text-[#fe8019] font-sans font-semibold border border-[#af3a03]/30">
                Administrator
              </span>
            </div>
            <p className="text-xs text-[#504945] dark:text-[#d6d4ce] leading-relaxed font-sans">
              Add and manage team members, manage active brand rules and guideline libraries, configure LLM check models, and audit logs.
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60 flex items-center gap-1.5 text-[11px] font-sans font-medium text-[#af3a03] dark:text-[#fe8019]">
            <Check className="w-3.5 h-3.5 text-[#af3a03] dark:text-[#fe8019] shrink-0" />
            <span>Organization-wide clearance</span>
          </div>
        </div>
      </div>

      {error && <InlineAlert title="Error" message={error} onRetry={loadMembers} />}

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-[#282828] backdrop-blur-md rounded-xl border border-[#e2ded5] dark:border-[#3c3836] p-2.5 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="w-4 h-4 text-[#a89984] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs font-mono rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#36755a]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end text-xs">
          <span className="text-[#a89984]">ROLE:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | Role)}
            className="p-1.5 px-2.5 rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-black/40 text-slate-700 dark:text-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-[#36755a] cursor-pointer"
          >
            <option value="all">ALL_ROLES [{members.length}]</option>
            <option value="creator">CREATORS [{members.filter((m) => m.role === 'creator').length}]</option>
            <option value="reviewer">REVIEWERS [{members.filter((m) => m.role === 'reviewer').length}]</option>
            <option value="admin">ADMINS [{members.filter((m) => m.role === 'admin').length}]</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : filteredMembers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          explanation="No team members match your filter criteria."
        />
      ) : (
        <div className="bg-white dark:bg-[#282828] backdrop-blur-xl rounded-xl border border-[#e2ded5] dark:border-[#3c3836] shadow-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#e2ded5] dark:border-[#3c3836] flex items-center justify-between text-xs">
            <span className="font-serif font-semibold text-[#282828] dark:text-[#fbf1c7] text-sm">
              Workspace Team Members ({filteredMembers.length})
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full divide-y divide-slate-200 dark:divide-white/10 text-left text-xs">
              <thead className="bg-[#edeae1]/60 dark:bg-[#1d2021]/60 text-[#706860] dark:text-[#a89984] font-sans font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th scope="col" className="px-5 py-3">Member</th>
                  <th scope="col" className="px-5 py-3">Email Address</th>
                  <th scope="col" className="px-5 py-3">Assigned Role</th>
                  <th scope="col" className="px-5 py-3 text-right">Last Active</th>
                  <th scope="col" className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-white/5 font-sans font-normal">
                {filteredMembers.map((m) => {
                  const initials = m.display_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-[#edeae1]/60 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-5 py-3 font-semibold text-[#282828] dark:text-white">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] font-sans font-bold flex items-center justify-center text-[10px] shrink-0">
                            {initials}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans font-semibold text-sm text-[#282828] dark:text-[#fbf1c7]">{m.display_name}</span>
                            {m.id === user?.id && (
                              <span className="text-[9px] font-sans font-bold bg-[#1d6f7a]/15 text-[#1d6f7a] dark:text-[#4ea8a0] border border-[#1d6f7a]/30 px-1.5 py-0.2 rounded uppercase">
                                YOU
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-[#706860] dark:text-[#a89984] font-sans text-xs">
                        {m.email}
                      </td>
                      <td className="px-5 py-3">
                        <select
                          value={m.role}
                          onChange={(e) =>
                            setPendingChange({
                              memberId: m.id,
                              memberName: m.display_name,
                              newRole: e.target.value as Role,
                            })
                          }
                          className="p-1 px-2 text-xs font-mono rounded border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-black/40 text-slate-800 dark:text-slate-200 font-medium capitalize focus:outline-none focus:ring-1 focus:ring-[#36755a] cursor-pointer"
                        >
                          <option value="creator">Creator (Submitter)</option>
                          <option value="reviewer">Reviewer (Approver)</option>
                          <option value="admin">Admin (Governance Lead)</option>
                        </select>
                      </td>
                      <td className="px-5 py-3 text-right text-[#a89984] font-mono text-[11px]">
                        {new Date(m.last_active).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {m.id !== user?.id ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingDelete({
                                memberId: m.id,
                                memberName: m.display_name,
                                email: m.email,
                              })
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-[#a89984] hover:text-rose-500 transition-colors cursor-pointer p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="Remove member from workspace"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>REVOKE</span>
                          </button>
                        ) : (
                          <span className="text-[10px] font-mono text-[#a89984]">PROTECTED</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-100"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-member-title"
        >
          <div className="bg-white dark:bg-[#11131a] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#e2ded5] dark:border-[#3c3836] space-y-4 animate-in zoom-in-95 duration-100 font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-white/5">
              <h2 id="add-member-title" className="text-sm font-bold text-[#282828] dark:text-white uppercase tracking-wider">
                Provision Workspace Resource
              </h2>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-[#a89984] hover:text-white p-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {addError && (
              <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-800 dark:text-rose-200">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddMember} className="space-y-3.5">
              <div>
                <label htmlFor="new-member-name" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                  Full Legal / Display Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="new-member-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Maya Sharma"
                  required
                  className="mt-1 w-full text-xs font-sans p-2.5 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#1d6f7a]"
                />
              </div>

              <div>
                <label htmlFor="new-member-email" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                  Enterprise Work Email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="new-member-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="maya@acme-cloud.io"
                  required
                  className="mt-1 w-full text-xs font-sans p-2.5 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#1d6f7a]"
                />
              </div>

              <div>
                <label htmlFor="new-member-role" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                  Assign Clearance Role <span className="text-rose-500">*</span>
                </label>
                <select
                  id="new-member-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Role)}
                  className="mt-1 w-full text-xs font-sans p-2.5 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#1d6f7a] cursor-pointer"
                >
                  <option value="creator">Creator (Submitter & Draft Author)</option>
                  <option value="reviewer">Reviewer (Brand Manager & Approver)</option>
                  <option value="admin">Admin (Governance Lead & Permissions Manager)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="new-member-password" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                    Initial Passphrase <span className="text-[#a89984] font-normal">(Optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="text-[10px] font-sans font-semibold text-[#1d6f7a] dark:text-[#4ea8a0] hover:underline cursor-pointer"
                  >
                    {showNewPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="new-member-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Default: Password123!"
                  autoComplete="new-password"
                  className="mt-1 w-full text-xs font-sans p-2.5 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#1d6f7a] placeholder:text-[#a89984]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#ded9ce] dark:border-[#3c3836]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-sans font-semibold border border-[#ded9ce] dark:border-[#3c3836] text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white cursor-pointer shadow-2xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="px-4 py-2 rounded-xl text-xs font-sans font-semibold text-white dark:text-[#1d2021] bg-[#1d6f7a] hover:bg-[#15545c] dark:bg-[#4ea8a0] dark:hover:bg-[#5ab8ad] disabled:opacity-50 cursor-pointer shadow-xs active:translate-y-[1px] transition-all"
                >
                  {isSubmittingAdd ? 'Provisioning...' : 'Provision Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Role Change Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(pendingChange)}
        title={`Change role for ${pendingChange?.memberName}?`}
        consequence={`Assigning the ${pendingChange?.newRole.toUpperCase()} role will immediately adjust this member's editing, review, and library governance permissions.`}
        confirmLabel="Confirm Role Change"
        confirmVariant="primary"
        onConfirm={handleRoleConfirm}
        onCancel={() => setPendingChange(null)}
      />

      {/* Remove Member Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Remove ${pendingDelete?.memberName} from team?`}
        consequence={`This will revoke access for ${pendingDelete?.email}. Their existing historical reviews, comments, and audit entries will remain preserved.`}
        confirmLabel="Remove Member"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

// S13: Append-Only Audit Log Page
export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  const loadAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAuditLog();
      setLogs(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const handleExportCSV = () => {
    const headers = ['Timestamp', 'Actor', 'Role', 'Action', 'Entity Type', 'Entity ID'];
    const rows = filteredLogs.map((l) => [
      l.created_at,
      `"${l.actor_name.replace(/"/g, '""')}"`,
      l.actor_role,
      l.action,
      l.entity_type,
      l.entity_id,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `dhrishyam_audit_trail_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyPayload = (logId: string, payload: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedRowId(logId);
    setTimeout(() => setCopiedRowId(null), 2000);
  };

  const filteredLogs = logs.filter((log) => {
    if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        log.actor_name.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entity_id.toLowerCase().includes(q) ||
        log.actor_role.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getActionPill = (action: string) => {
    const upper = action.toUpperCase();
    if (upper.includes('APPROVE')) {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {action}
        </span>
      );
    }
    if (upper.includes('CHANGE') || upper.includes('OVERRIDE')) {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-[#d65d0e]/10 text-[#d65d0e] dark:text-[#fe8019] border border-[#d65d0e]/20">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d65d0e] dark:bg-[#fe8019]" />
          {action}
        </span>
      );
    }
    if (upper.includes('DELETE') || upper.includes('REMOVE')) {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {action}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        {action}
      </span>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-normal text-[#282828] dark:text-[#fbf1c7] tracking-tight">
              Audit Trail & Compliance Ledger
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#edeae1] dark:bg-[#32302f] text-[#4a4440] dark:text-[#ebdbb2] border border-[#e2ded5] dark:border-[#3c3836]">
              <Shield className="w-3.5 h-3.5 text-blue-500" />
              <span>Sequenced Ledger</span>
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#5c5650] dark:text-[#d5c4a1] mt-1">
            Cryptographically sequenced, immutable record of all editorial decisions, policy overrides, and governance events.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-[#4a4440] dark:text-[#ebdbb2] bg-white dark:bg-white/[0.04] border border-[#e2ded5] dark:border-[#3c3836] hover:bg-[#edeae1]/60 dark:hover:bg-white/[0.08] transition-all shadow-2xs cursor-pointer tap-interactive self-start sm:self-auto"
        >
          <Download className="w-4 h-4 text-[#a89984]" />
          <span>Export CSV</span>
        </button>
      </div>

      {error && <InlineAlert title="Error" message={error} onRetry={loadAudit} />}

      {/* Filter toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-[#282828] backdrop-blur-md p-2.5 rounded-xl border border-[#e2ded5] dark:border-[#3c3836] shadow-2xs text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#a89984] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by actor, action, role, or entity ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] placeholder:text-[#a89984] focus:outline-none focus:ring-2 focus:ring-[#36755a]/20 focus:border-[#36755a]"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label className="text-[#706860] dark:text-[#a89984] font-medium">Entity:</label>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="p-1.5 px-2.5 rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-black/40 text-[#4a4440] dark:text-[#ebdbb2] capitalize focus:outline-none focus:ring-1 focus:ring-[#36755a] cursor-pointer"
          >
            <option value="all">All Entities ({logs.length})</option>
            <option value="content">Content</option>
            <option value="library">Library</option>
            <option value="finding">Finding</option>
            <option value="workflow">Workflow</option>
            <option value="member">Member</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : filteredLogs.length === 0 ? (
        <EmptyState
          icon={<Shield className="w-6 h-6" />}
          explanation="No events match your filter criteria."
        />
      ) : (
        <div className="bg-white dark:bg-[#282828] backdrop-blur-xl rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[780px] w-full divide-y divide-slate-200 dark:divide-white/10 text-left text-xs">
              <thead className="bg-[#edeae1]/60 dark:bg-[#1d2021]/60 text-[#706860] dark:text-[#a89984] font-sans font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th scope="col" className="px-5 py-3">Timestamp</th>
                  <th scope="col" className="px-5 py-3">Actor</th>
                  <th scope="col" className="px-5 py-3">Action</th>
                  <th scope="col" className="px-5 py-3">Entity Type</th>
                  <th scope="col" className="px-5 py-3">Entity ID</th>
                  <th scope="col" className="px-5 py-3 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-white/5 font-sans font-normal">
                {filteredLogs.map((log) => {
                  const isExpanded = expandedRowId === log.id;
                  const isCopied = copiedRowId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setExpandedRowId(isExpanded ? null : log.id)}
                        className="hover:bg-[#edeae1]/60 dark:hover:bg-white/[0.03] cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5 font-mono text-[11px] text-[#706860] whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="font-sans font-semibold text-sm text-[#282828] dark:text-[#fbf1c7]">{log.actor_name}</span>
                          <span className="ml-1 text-[10px] font-mono text-[#a89984]">
                            [{log.actor_role.toUpperCase()}]
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {getActionPill(log.action)}
                        </td>
                        <td className="px-5 py-3.5 capitalize text-slate-600 dark:text-slate-300 whitespace-nowrap font-mono text-[11px]">
                          {log.entity_type}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-[#706860] text-[11px] whitespace-nowrap">
                          {log.entity_id}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[#a89984] hover:text-slate-700 dark:hover:text-white cursor-pointer font-mono text-[11px]"
                          >
                            <span>{isExpanded ? 'CLOSE' : 'INSPECT'}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#edeae1]/60/80 dark:bg-black/40">
                          <td colSpan={6} className="p-4 sm:px-6">
                            <div className="bg-[#1d2021] dark:bg-black rounded-lg border border-slate-800 p-3.5 space-y-2 shadow-inner">
                              <div className="flex items-center justify-between text-[#a89984] text-[10px] font-mono border-b border-slate-800 pb-2">
                                <span>Audit Payload Signature: {log.id}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyPayload(log.id, log.payload);
                                  }}
                                  className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 cursor-pointer"
                                >
                                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  <span>{isCopied ? 'COPIED' : 'COPY JSON'}</span>
                                </button>
                              </div>
                              <pre className="font-mono text-[11px] text-slate-200 overflow-x-auto leading-relaxed pt-1">
                                {JSON.stringify(log.payload, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
