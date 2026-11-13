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

// S12: Team & Roles Page
export const TeamPage: React.FC = () => {
  const { user, pushToast } = useApp();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header with Title and Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Team & Role Permissions</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Building2 className="w-3.5 h-3.5 text-indigo-500" />
              <span>Active Workspace: {user?.org_name || 'Current Organization'}</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage workspace members, invite new staff resources, and govern role-based access control.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddError(null);
            setIsAddModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-xs cursor-pointer self-start sm:self-auto"
        >
          <span>+ Add Member</span>
        </button>
      </div>

      {/* Role Definitions Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-600" />
            <h3 className="text-xs font-bold text-indigo-950 uppercase tracking-wide">Creator Role</h3>
          </div>
          <p className="text-[11px] text-slate-600 mt-1 leading-snug">
            Draft copy, run automated guideline & policy checks in real time, view findings, and submit content for reviewer sign-off.
          </p>
        </div>
        <div className="p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
            <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">Reviewer Role</h3>
          </div>
          <p className="text-[11px] text-slate-600 mt-1 leading-snug">
            Review submitted drafts in queue, evaluate findings, leave anchored feedback, and issue official approvals or change requests.
          </p>
        </div>
        <div className="p-3.5 rounded-xl border border-purple-100 bg-purple-50/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-600" />
            <h3 className="text-xs font-bold text-purple-950 uppercase tracking-wide">Admin Role</h3>
          </div>
          <p className="text-[11px] text-slate-600 mt-1 leading-snug">
            Exclusive authority to add/remove resources, assign member roles, manage brand library rules, and audit all platform actions.
          </p>
        </div>
      </div>

      {error && <InlineAlert title="Error" message={error} onRetry={loadMembers} />}

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">
              Workspace Resources ({members.length})
            </span>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">Member</th>
                <th scope="col" className="px-4 py-3">Email Address</th>
                <th scope="col" className="px-4 py-3">Assigned Role</th>
                <th scope="col" className="px-4 py-3 text-right">Last Active</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-normal">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-900 text-white font-medium flex items-center justify-center text-[10px] shrink-0">
                        {m.display_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span>{m.display_name}</span>
                      {m.id === user?.id && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-normal">
                          You
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">{m.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={m.role}
                      onChange={(e) =>
                        setPendingChange({
                          memberId: m.id,
                          memberName: m.display_name,
                          newRole: e.target.value as Role,
                        })
                      }
                      className="p-1.5 text-xs rounded-lg border border-slate-300 bg-white font-medium capitalize focus:ring-2 focus:ring-indigo-600 focus:outline-none cursor-pointer"
                    >
                      <option value="creator">Creator (Submitter)</option>
                      <option value="reviewer">Reviewer (Approver)</option>
                      <option value="admin">Admin (Governance Lead)</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400 font-mono text-[11px]">
                    {new Date(m.last_active).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.id !== user?.id && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDelete({
                            memberId: m.id,
                            memberName: m.display_name,
                            email: m.email,
                          })
                        }
                        className="text-[11px] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Remove member from workspace"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Member Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-member-title"
        >
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 id="add-member-title" className="text-base font-bold text-slate-900">
                Add Workspace Member
              </h2>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {addError && (
              <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label htmlFor="new-member-name" className="block text-xs font-semibold text-slate-700">
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="new-member-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Maya Sharma"
                  required
                  className="mt-1 w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="new-member-email" className="block text-xs font-semibold text-slate-700">
                  Work Email <span className="text-rose-600">*</span>
                </label>
                <input
                  id="new-member-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. maya@acme-cloud.io"
                  required
                  className="mt-1 w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="new-member-role" className="block text-xs font-semibold text-slate-700">
                  Assign Role <span className="text-rose-600">*</span>
                </label>
                <select
                  id="new-member-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Role)}
                  className="mt-1 w-full text-xs p-2 rounded-lg border border-slate-300 bg-white font-medium capitalize focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                >
                  <option value="creator">Creator (Submitter & Draft Author)</option>
                  <option value="reviewer">Reviewer (Brand Manager & Approver)</option>
                  <option value="admin">Admin (Governance Lead & Permissions Manager)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  The member will be able to log in immediately with this email address and access role workflows.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="new-member-password" className="block text-xs font-semibold text-slate-700">
                    Initial Password <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800"
                  >
                    {showNewPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="new-member-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Default: Password123! if blank"
                  autoComplete="new-password"
                  className="mt-1 w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400 font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Initial offline login credential. If left blank, defaults to <code className="text-slate-700 font-mono bg-slate-100 px-1 rounded">Password123!</code>.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
                >
                  {isSubmittingAdd ? 'Adding...' : 'Add Member'}
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
      l.actor_name,
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

  const filteredLogs = logs.filter((log) => {
    if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        log.actor_name.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entity_id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Audit Trail</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable, append-only security log recording every brand policy check, edit, and approval decision.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors shadow-xs"
        >
          <Download className="w-4 h-4 text-slate-500" />
          <span>Export Audit CSV</span>
        </button>
      </div>

      {error && <InlineAlert title="Error" message={error} onRetry={loadAudit} />}

      {/* Filter toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by actor, action, or entity ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-500 font-medium">Entity:</label>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 capitalize focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="all">All Entities</option>
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">Timestamp</th>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Entity Type</th>
                <th scope="col" className="px-4 py-3">Entity ID</th>
                <th scope="col" className="px-4 py-3 text-right">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-normal">
              {filteredLogs.map((log) => {
                const isExpanded = expandedRowId === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => setExpandedRowId(isExpanded ? null : log.id)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-900">{log.actor_name}</span>
                        <span className="ml-1 text-[11px] text-slate-500">({log.actor_role})</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-indigo-700 font-semibold whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600 whitespace-nowrap">
                        {log.entity_type}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 text-[11px] whitespace-nowrap">
                        {log.entity_id}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-700"
                        >
                          <span className="text-[11px]">{isExpanded ? 'Hide' : 'View'}</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="font-mono text-[11px] text-slate-800 bg-white p-3 rounded-lg border border-slate-200 overflow-x-auto">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
