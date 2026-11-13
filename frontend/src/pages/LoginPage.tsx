// src/pages/LoginPage.tsx
import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ArrowRight,
  Loader2,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types/domain';

export const LoginPage: React.FC = () => {
  const { login, loginAsRole, registerBrand, setDisclosureOpen, currentRoute, navigate } = useApp();

  // Active tab: 'login' | 'register'
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(
    () => (typeof window !== 'undefined' && window.location.hash === '#register' ? 'register' : 'login')
  );

  // Sign In form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Register Brand form state
  const [brandName, setBrandName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [seedRules, setSeedRules] = useState(true);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // Synchronize hash with active tab
  useEffect(() => {
    if (window.location.hash === '#register' || currentRoute === 'register') {
      setActiveTab('register');
    } else {
      setActiveTab('login');
    }
  }, [currentRoute]);

  const handleTabSwitch = (tab: 'login' | 'register') => {
    setActiveTab(tab);
    setErrorMsg(null);
    setErrorStatus(null);
    setRegError(null);
    if (tab === 'register') {
      navigate('register');
    } else {
      navigate('login');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both your work email and password.');
      setErrorStatus(null);
      return;
    }
    setErrorMsg(null);
    setErrorStatus(null);
    setIsLoading(true);

    const result = await login(email.trim(), password);
    setIsLoading(false);

    if (!result.success) {
      if (result.error?.includes('401') || result.error?.toLowerCase().includes('invalid')) {
        setErrorStatus(401);
      } else if (result.error?.includes('403') || result.error?.toLowerCase().includes('forbidden')) {
        setErrorStatus(403);
      } else {
        setErrorStatus(null);
      }
      setErrorMsg(result.error || 'Invalid work email or password. Please try again.');
    }
  };

  const handleDemoQuickLogin = (role: Role) => {
    if (loginAsRole) {
      loginAsRole(role);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim() || !adminName.trim() || !adminEmail.trim() || !regPassword.trim()) {
      setRegError('All fields marked with an asterisk are required.');
      return;
    }
    if (regPassword.length < 8) {
      setRegError('Password must be at least 8 characters long for offline security.');
      return;
    }
    if (regPassword !== confirmPassword) {
      setRegError('Passwords do not match. Please re-enter carefully.');
      return;
    }

    setRegError(null);
    setRegLoading(true);

    if (registerBrand) {
      const result = await registerBrand({
        brand_name: brandName.trim(),
        admin_name: adminName.trim(),
        admin_email: adminEmail.trim(),
        password: regPassword,
        seed_default_rules: seedRules,
      });
      setRegLoading(false);
      if (!result.success) {
        setRegError(result.error || 'Failed to register brand organization.');
      }
    } else {
      setRegLoading(false);
      setRegError('Brand registration service is currently unavailable.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center text-xl shadow-md">
          Dh
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
          Dhrishyam
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Pre-Publication Brand Governance & Multi-Tenant Platform
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-6 px-6 shadow-xl border border-slate-200 sm:rounded-2xl sm:px-8">
          {/* Segmented Tab Bar */}
          <div className="flex border-b border-slate-200 mb-6" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'login'}
              onClick={() => handleTabSwitch('login')}
              className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer text-center ${
                activeTab === 'login'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'register'}
              onClick={() => handleTabSwitch('register')}
              className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer text-center ${
                activeTab === 'register'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Register Brand
            </button>
          </div>

          {/* TAB 1: SIGN IN */}
          {activeTab === 'login' && (
            <div>
              {/* Contextual Error Banners */}
              {errorStatus === 401 && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed"
                >
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Authentication Failed (401):</span> Invalid work email or password. Verify credentials or use one of the seeded demo accounts below.
                  </div>
                </div>
              )}

              {errorStatus === 403 && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-900 leading-relaxed"
                >
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Access Forbidden (403):</span> Your user account does not have access permissions for this brand workspace.
                  </div>
                </div>
              )}

              {!errorStatus && errorMsg && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700">
                    Work Email
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                      required
                      className="w-full text-sm p-2.5 pl-3 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div className="relative mt-1">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                      className="w-full text-sm p-2.5 pl-3 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in to Workspace</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Seeded Acme Cloud Quick-Login Drawer */}
              <div className="mt-6 pt-5 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    ⚡ Acme Cloud Demo Accounts
                  </span>
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium border border-emerald-200">
                    Offline Seeded
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDemoQuickLogin('creator')}
                    className="flex flex-col items-center justify-center p-2 rounded-lg border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 transition-colors text-center cursor-pointer group"
                  >
                    <span className="text-xs font-bold text-indigo-900">Aarav</span>
                    <span className="text-[10px] font-medium text-indigo-600 uppercase tracking-wider mt-0.5">
                      Creator
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDemoQuickLogin('reviewer')}
                    className="flex flex-col items-center justify-center p-2 rounded-lg border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100 transition-colors text-center cursor-pointer group"
                  >
                    <span className="text-xs font-bold text-emerald-900">Priya</span>
                    <span className="text-[10px] font-medium text-emerald-600 uppercase tracking-wider mt-0.5">
                      Reviewer
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDemoQuickLogin('admin')}
                    className="flex flex-col items-center justify-center p-2 rounded-lg border border-purple-200 bg-purple-50/60 hover:bg-purple-100 transition-colors text-center cursor-pointer group"
                  >
                    <span className="text-xs font-bold text-purple-900">Kabir</span>
                    <span className="text-[10px] font-medium text-purple-600 uppercase tracking-wider mt-0.5">
                      Admin
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: REGISTER BRAND */}
          {activeTab === 'register' && (
            <div>
              {regError && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed"
                >
                  {regError}
                </div>
              )}

              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="reg-brand-name" className="block text-xs font-semibold text-slate-700">
                    Brand / Company Name <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="reg-brand-name"
                      type="text"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      placeholder="e.g. Nexus Dynamics"
                      required
                      className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-admin-name" className="block text-xs font-semibold text-slate-700">
                    Admin Full Name <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="reg-admin-name"
                      type="text"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="e.g. Maya Lin"
                      required
                      className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-admin-email" className="block text-xs font-semibold text-slate-700">
                    Admin Work Email <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="reg-admin-email"
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@nexus-dynamics.com"
                      required
                      className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-password" className="block text-xs font-semibold text-slate-700">
                      Master Password <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative mt-1">
                      <input
                        id="reg-password"
                        type={showRegPassword ? 'text' : 'password'}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Min 8 chars"
                        required
                        className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="reg-confirm-password" className="block text-xs font-semibold text-slate-700">
                      Confirm Password <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative mt-1">
                      <input
                        id="reg-confirm-password"
                        type={showRegPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        required
                        className="w-full text-sm p-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700">
                    <input
                      type="checkbox"
                      checked={seedRules}
                      onChange={(e) => setSeedRules(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Seed default governance rules</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                    className="text-indigo-600 hover:text-indigo-800 text-[11px]"
                  >
                    {showRegPassword ? 'Hide Passwords' : 'Show Passwords'}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full mt-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  {regLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating brand organization...</span>
                    </>
                  ) : (
                    <>
                      <span>Register Brand & Workspace</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Bottom Disclosure Link */}
          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => setDisclosureOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>Responsible AI & Data Privacy Disclosure</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
