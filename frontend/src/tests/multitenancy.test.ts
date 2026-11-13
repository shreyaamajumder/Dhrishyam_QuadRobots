// src/tests/multitenancy.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, SEEDED_ACME_WORKSPACE } from '../services/api';
import { ApiClientError } from '../services/api';
import { RegisterBrandPayload, UserProfile } from '../types/domain';

// Polyfill localStorage for Node test runner if needed
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, String(val));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (idx: number) => Array.from(store.keys())[idx] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

test('Seeded Acme Cloud workspace has constant ID and admin role', () => {
  assert.equal(SEEDED_ACME_WORKSPACE.id, '00000000-0000-0000-0000-000000000001');
  assert.equal(SEEDED_ACME_WORKSPACE.org_id, '00000000-0000-0000-0000-000000000001');
  assert.equal(SEEDED_ACME_WORKSPACE.name, 'Acme Cloud Workspace');
  assert.equal(SEEDED_ACME_WORKSPACE.role, 'admin');
});

test('getDemoUsers returns seeded creator, reviewer, and admin for Acme Cloud', () => {
  const demoUsers = api.getDemoUsers();
  assert.ok(demoUsers.creator, 'Creator demo user exists');
  assert.ok(demoUsers.reviewer, 'Reviewer demo user exists');
  assert.ok(demoUsers.admin, 'Admin demo user exists');

  assert.equal(demoUsers.creator.role, 'creator');
  assert.equal(demoUsers.reviewer.role, 'reviewer');
  assert.equal(demoUsers.admin.role, 'admin');

  assert.equal(demoUsers.creator.org_id, SEEDED_ACME_WORKSPACE.id);
  assert.equal(demoUsers.reviewer.org_id, SEEDED_ACME_WORKSPACE.id);
  assert.equal(demoUsers.admin.org_id, SEEDED_ACME_WORKSPACE.id);
});

test('registerBrand provisions a new brand organization and admin profile', async () => {
  const payload: RegisterBrandPayload = {
    brand_name: 'Starlight Media',
    admin_name: 'Elena Rostova',
    admin_email: 'elena@starlight-media.com',
    password: 'SecurePassword2026!',
    seed_default_rules: true,
  };

  const user = await api.registerBrand(payload);

  assert.ok(user.id, 'User ID must be generated');
  assert.equal(user.email, 'elena@starlight-media.com');
  assert.equal(user.display_name, 'Elena Rostova');
  assert.equal(user.role, 'admin');
  assert.equal(user.org_name, 'Starlight Media');
  assert.ok(user.org_id, 'Organization ID must be generated');
  assert.notEqual(user.org_id, SEEDED_ACME_WORKSPACE.id, 'Must be distinct from Acme Cloud');

  // Must attach organizations list containing new brand and Acme Cloud
  assert.ok(Array.isArray(user.organizations), 'organizations must be an array');
  const hasNewBrand = user.organizations!.some((t) => t.name === 'Starlight Media');
  const hasAcme = user.organizations!.some(
    (t) => t.id === SEEDED_ACME_WORKSPACE.id || t.org_id === SEEDED_ACME_WORKSPACE.id
  );
  assert.ok(hasNewBrand, 'New brand must be in accessible organizations list');
  assert.ok(hasAcme, 'Seeded Acme Cloud must remain accessible in organizations list');

  // Verify localStorage session persistence
  const storedUser = JSON.parse(localStorage.getItem('dhrishyam_user') || '{}');
  assert.equal(storedUser.email, 'elena@starlight-media.com');
  assert.ok(localStorage.getItem('dhrishyam_token'), 'Session token must be stored');
});

test('getWorkspaces returns list containing active workspace and seeded Acme Cloud', async () => {
  const demoAdmin = api.getDemoUsers().admin;
  const workspaces = await api.getWorkspaces(demoAdmin);

  assert.ok(Array.isArray(workspaces));
  assert.ok(workspaces.length >= 1);
  const acmeWs = workspaces.find(
    (w) => w.id === SEEDED_ACME_WORKSPACE.id || w.org_id === SEEDED_ACME_WORKSPACE.id
  );
  assert.ok(acmeWs, 'Acme Cloud workspace must be present');
  assert.equal(acmeWs.name, 'Acme Cloud Workspace');
});

test('addMember provisions user with password and enforces tenant isolation', async () => {
  const brandAdmin: UserProfile = {
    id: 'usr_brand_admin_99',
    email: 'admin@brand-x.com',
    display_name: 'Brand X Admin',
    role: 'admin',
    org_id: 'org_brand_x_99',
    org_name: 'Brand X Global',
    library_version: 1,
    last_active: new Date().toISOString(),
  };

  const newMemberEmail = `writer_${Date.now()}@brand-x.com`;
  const memberPassword = 'InitialWriterPass123!';

  const updatedMembers = await api.addMember(brandAdmin, {
    display_name: 'Tara Writer',
    email: newMemberEmail,
    role: 'creator',
    password: memberPassword,
  });

  assert.ok(Array.isArray(updatedMembers));
  const created = updatedMembers.find((m) => m.email === newMemberEmail);
  assert.ok(created, 'Newly added member must exist in returned member list');
  assert.equal(created.display_name, 'Tara Writer');
  assert.equal(created.role, 'creator');
  assert.equal(created.org_id, brandAdmin.org_id);

  // Cross-tenant data isolation: members from Acme Cloud must not appear in Brand X's member list
  const hasAcmeMembers = updatedMembers.some(
    (m) => m.org_id === SEEDED_ACME_WORKSPACE.id
  );
  assert.equal(hasAcmeMembers, false, 'Acme Cloud members must not leak into Brand X members list');

  // Verify Tara can log in with her newly provisioned password
  const loggedInMember = await api.login(newMemberEmail, memberPassword);
  assert.equal(loggedInMember.email, newMemberEmail);
  assert.equal(loggedInMember.role, 'creator');
  assert.equal(loggedInMember.org_id, brandAdmin.org_id);
});

test('login rejects invalid passwords with 401 status and generic error message', async () => {
  const brandAdmin: UserProfile = {
    id: 'usr_brand_admin_100',
    email: 'boss@brand-y.com',
    display_name: 'Brand Y Boss',
    role: 'admin',
    org_id: 'org_brand_y_100',
    org_name: 'Brand Y',
    library_version: 1,
    last_active: new Date().toISOString(),
  };

  const testEmail = `reviewer_${Date.now()}@brand-y.com`;
  await api.addMember(brandAdmin, {
    display_name: 'Bob Reviewer',
    email: testEmail,
    role: 'reviewer',
    password: 'CorrectPassword1!',
  });

  // Attempt login with wrong password
  await assert.rejects(
    async () => {
      await api.login(testEmail, 'WrongPassword!');
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.message, 'Invalid work email or password.');
      return true;
    }
  );
});

test('login rejects non-existent email with generic 401 anti-enumeration error', async () => {
  await assert.rejects(
    async () => {
      await api.login('nonexistent.user.2026@unknown-domain.io', 'SomePassword123!');
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.message, 'Invalid work email or password.');
      return true;
    }
  );
});

test('logout clears credentials from localStorage', async () => {
  localStorage.setItem('dhrishyam_token', 'test-token-to-be-removed');
  localStorage.setItem('dhrishyam_user', JSON.stringify({ email: 'test@example.com' }));
  localStorage.setItem('dhrishyam_tenants', JSON.stringify([{ id: 'test-org' }]));

  await api.logout();

  assert.equal(localStorage.getItem('dhrishyam_token'), null);
  assert.equal(localStorage.getItem('dhrishyam_user'), null);
  assert.equal(localStorage.getItem('dhrishyam_tenants'), null);
});

test('login rejects empty password with 401 status and generic error message', async () => {
  const brand = await api.registerBrand({
    brand_name: 'Auth Security Brand',
    admin_name: 'Security Admin',
    admin_email: `sec_admin_${Date.now()}@auth-sec.io`,
    password: 'StrongPassword123!',
  });

  await assert.rejects(
    async () => {
      await api.login(brand.email, '');
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.message, 'Invalid work email or password.');
      return true;
    }
  );
});

test('login rejects undefined password with 401 status and generic error message', async () => {
  const brand = await api.registerBrand({
    brand_name: 'Undef Pass Brand',
    admin_name: 'Undef Admin',
    admin_email: `undef_admin_${Date.now()}@undef-pass.io`,
    password: 'StrongPassword123!',
  });

  await assert.rejects(
    async () => {
      await api.login(brand.email, undefined);
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.message, 'Invalid work email or password.');
      return true;
    }
  );
});

test('login rejects wrong password for demo accounts with 401 status', async () => {
  const demoUsers = api.getDemoUsers();
  for (const role of ['creator', 'reviewer', 'admin'] as const) {
    const demo = demoUsers[role];
    await assert.rejects(
      async () => {
        await api.login(demo.email, 'ArbitraryHackedPassword999!');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 401);
        assert.equal(err.code, 'unauthorized');
        assert.equal(err.message, 'Invalid work email or password.');
        return true;
      }
    );
  }
});

test('login succeeds for demo account with correct seeded password', async () => {
  const demoAdmin = api.getDemoUsers().admin;
  const user = await api.login(demoAdmin.email, 'Password123!');
  assert.equal(user.email, demoAdmin.email);
  assert.equal(user.role, 'admin');
  assert.equal(user.org_id, SEEDED_ACME_WORKSPACE.id);
});

test('getWorkspaces does not leak cross-tenant workspaces across registered brands', async () => {
  const brandAlpha = await api.registerBrand({
    brand_name: 'Brand Alpha Unique Corp',
    admin_name: 'Alpha Admin',
    admin_email: `alpha_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@corp-a.io`,
    password: 'AlphaPassword123!',
  });

  const brandBeta = await api.registerBrand({
    brand_name: 'Brand Beta Unique Corp',
    admin_name: 'Beta Admin',
    admin_email: `beta_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@corp-b.io`,
    password: 'BetaPassword123!',
  });

  // Query workspaces for Brand Alpha
  const alphaWorkspaces = await api.getWorkspaces(brandAlpha);
  const betaLeakedInAlpha = alphaWorkspaces.some(
    (w) => w.name === 'Brand Beta Unique Corp' || w.id === brandBeta.org_id || w.org_id === brandBeta.org_id
  );
  assert.equal(betaLeakedInAlpha, false, 'Brand Beta must not leak into Brand Alpha workspaces');

  // Query workspaces for Brand Beta
  const betaWorkspaces = await api.getWorkspaces(brandBeta);
  const alphaLeakedInBeta = betaWorkspaces.some(
    (w) => w.name === 'Brand Alpha Unique Corp' || w.id === brandAlpha.org_id || w.org_id === brandAlpha.org_id
  );
  assert.equal(alphaLeakedInBeta, false, 'Brand Alpha must not leak into Brand Beta workspaces');

  // Both must still have access to Seeded Acme Cloud
  const alphaHasAcme = alphaWorkspaces.some(
    (w) => w.id === SEEDED_ACME_WORKSPACE.id || w.org_id === SEEDED_ACME_WORKSPACE.id
  );
  assert.ok(alphaHasAcme, 'Seeded Acme Cloud workspace must remain accessible to Brand Alpha');

  const betaHasAcme = betaWorkspaces.some(
    (w) => w.id === SEEDED_ACME_WORKSPACE.id || w.org_id === SEEDED_ACME_WORKSPACE.id
  );
  assert.ok(betaHasAcme, 'Seeded Acme Cloud workspace must remain accessible to Brand Beta');
});
