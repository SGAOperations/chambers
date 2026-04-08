'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'

function UsersTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Skeleton className="h-9 w-24 rounded-lg animate-pulse" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="border border-[#1e5080] rounded-xl bg-[#184073] p-4 flex items-center justify-between animate-pulse">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-52" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}


const ADMIN_ROLES = [
  'Executive Vice President',
  'Vice President of Operational Affairs',
  'Comptroller',
  'Digital Innovation Project Member',
]

const IEMS_ROLES = [
  'Vice President of External Affairs',
  'Assistant Vice President of External Affairs',
  'Director of Events',
]

interface Membership {
  id: string
  role: 'Leadership' | 'Member'
  bodies: {
    id: string
    name: string
    division: string
  } | null
}

interface User {
  id: string
  email: string
  full_name: string
  admin_role: string | null
  iems_role: string | null
  is_active: boolean
  created_at: string
  board_memberships: Membership[]
}

interface Body {
  id: string
  name: string
  division: string
}

export default function UsersTab() {
  const [users, setUsers] = useState<User[]>([])
  const [bodies, setBodies] = useState<Body[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', full_name: '', admin_role: '' })
  const [creating, setCreating] = useState(false)
  const [addingMembership, setAddingMembership] = useState<string | null>(null)
  const [newMembership, setNewMembership] = useState({ body_id: '', role: 'Member' })
  const [adminRoleError, setAdminRoleError] = useState<string | null>(null)
  const [togglingActive, setTogglingActive] = useState<string | null>(null)

  const fetchUsers = async () => {
    const res = await fetch('/api/administrator/users')
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }

  const fetchBodies = async () => {
    const res = await fetch('/api/administrator/bodies')
    const data = await res.json()
    setBodies(data.bodies || [])
  }

  useEffect(() => {
    fetchUsers()
    fetchBodies()
  }, [])

  const createUser = async () => {
    setCreating(true)
    await fetch('/api/administrator/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    })
    setNewUser({ email: '', full_name: '', admin_role: '' })
    setShowCreateForm(false)
    await fetchUsers()
    setCreating(false)
  }

  const addMembership = async (userId: string) => {
    await fetch('/api/administrator/users/memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...newMembership }),
    })
    setNewMembership({ body_id: '', role: 'Member' })
    setAddingMembership(null)
    await fetchUsers()
  }

  const removeMembership = async (membershipId: string) => {
    await fetch('/api/administrator/users/memberships', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: membershipId }),
    })
    await fetchUsers()
  }

  const updateAdminRole = async (userId: string, newRole: string) => {
    setAdminRoleError(null)
    const VP_ROLE = 'Vice President of Operational Affairs'
    const currentUser = users.find(u => u.id === userId)
    if (currentUser?.admin_role === VP_ROLE && newRole !== VP_ROLE) {
      const vpCount = users.filter(u => u.admin_role === VP_ROLE).length
      if (vpCount <= 1) {
        setAdminRoleError('Cannot remove the only Vice President of Operational Affairs.')
        return
      }
    }
    await fetch('/api/administrator/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, admin_role: newRole || null }),
    })
    await fetchUsers()
  }

  const updateIEMSRole = async (userId: string, newRole: string) => {
    await fetch('/api/administrator/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, iems_role: newRole || null }),
    })
    await fetchUsers()
  }

  const toggleActiveStatus = async (userId: string, currentlyActive: boolean) => {
    setTogglingActive(userId)
    await fetch('/api/administrator/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, is_active: !currentlyActive }),
    })
    await fetchUsers()
    setTogglingActive(null)
  }

  const toggleMembershipRole = async (membershipId: string, currentRole: string) => {
    const newRole = currentRole === 'Leadership' ? 'Member' : 'Leadership'
    await fetch('/api/administrator/users/memberships', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: membershipId, role: newRole }),
    })
    await fetchUsers()
  }

  if (loading) return <UsersTabSkeleton />

  const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"

  return (
    <div className="space-y-4">
      {/* Create user button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors"
        >
          + New User
        </button>
      </div>

      {/* Create user form */}
      {showCreateForm && (
        <div className="border border-[#1e5080] rounded-xl p-5 bg-[#0f2a4a] space-y-3">
          <h3 className="font-semibold text-[#f0f6ff]">Create New User</h3>
          <input
            type="text"
            placeholder="Full Name"
            value={newUser.full_name}
            onChange={e => setNewUser({ ...newUser, full_name: e.target.value })}
            className={inputCls}
          />
          <input
            type="email"
            placeholder="Email"
            value={newUser.email}
            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
            className={inputCls}
          />
          <select
            value={newUser.admin_role}
            onChange={e => setNewUser({ ...newUser, admin_role: e.target.value })}
            className={inputCls}
          >
            <option value="">No Admin Role</option>
            {ADMIN_ROLES.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={createUser}
              disabled={creating || !newUser.email || !newUser.full_name}
              className="px-4 py-2 bg-[#0a1628] hover:bg-[#0f2040] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users list */}
      {users.length === 0 ? (
        <p className="text-[#6a96bb] text-sm">No users found.</p>
      ) : (
        users.map(u => (
          <div key={u.id} className="border border-[#1e5080] rounded-xl bg-[#184073] shadow-sm">
            {/* User row */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-[#1a4d8a] rounded-xl transition-colors"
              onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
            >
              <div>
                <p className="font-semibold text-[#f0f6ff]">{u.full_name}</p>
                <p className="text-sm text-[#93b8d8]">{u.email}</p>
                {u.admin_role && (
                  <p className="text-xs text-[#c8102e] font-medium mt-0.5">{u.admin_role}</p>
                )}
                {u.iems_role && (
                  <p className="text-xs text-[#22d3ee] font-medium mt-0.5">IEMS: {u.iems_role}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${u.is_active ? 'bg-[#0f3d20] text-[#4ade80]' : 'bg-[#3d0f0f] text-[#f87171]'}`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-[#6a96bb] text-xs">{expandedUser === u.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded section */}
            {expandedUser === u.id && (
              <div className="border-t border-[#1e5080] px-4 py-4 space-y-4 bg-[#0f2a4a]/50 rounded-b-xl">
                {/* Admin role */}
                <div>
                  <h4 className="text-sm font-semibold text-[#f0f6ff] mb-2">Admin Role</h4>
                  {adminRoleError && (
                    <p className="text-xs text-[#f87171] mb-2">{adminRoleError}</p>
                  )}
                  <select
                    value={u.admin_role ?? ''}
                    onChange={e => updateAdminRole(u.id, e.target.value)}
                    className={inputCls}
                  >
                    <option value="">No Admin Role</option>
                    {ADMIN_ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                {/* IEMS role */}
                <div>
                  <h4 className="text-sm font-semibold text-[#f0f6ff] mb-1">IEMS Role</h4>
                  <p className="text-xs text-[#6a96bb] mb-2">Mutually exclusive with Admin Role.</p>
                  <select
                    value={u.iems_role ?? ''}
                    onChange={e => updateIEMSRole(u.id, e.target.value)}
                    className={inputCls}
                  >
                    <option value="">No IEMS Role</option>
                    {IEMS_ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                {/* Active status */}
                <div>
                  <h4 className="text-sm font-semibold text-[#f0f6ff] mb-2">Account Status</h4>
                  <button
                    onClick={() => toggleActiveStatus(u.id, u.is_active)}
                    disabled={togglingActive === u.id}
                    className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      u.is_active
                        ? 'bg-[#3d0f0f] text-[#f87171] hover:bg-[#5a1414]'
                        : 'bg-[#0f3d20] text-[#4ade80] hover:bg-[#1a5c30]'
                    }`}
                  >
                    {togglingActive === u.id
                      ? 'Updating...'
                      : u.is_active ? 'Deactivate User' : 'Activate User'}
                  </button>
                </div>
                {/* Body memberships */}
                <div>
                  <h4 className="text-sm font-semibold text-[#f0f6ff] mb-2">Body Memberships</h4>
                  {u.board_memberships.length === 0 ? (
                    <p className="text-sm text-[#6a96bb]">No memberships assigned.</p>
                  ) : (
                    <div className="space-y-2">
                      {u.board_memberships.map(m => (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                          <span className="text-[#93b8d8]">{m.bodies?.name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleMembershipRole(m.id, m.role)}
                              className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                                m.role === 'Leadership'
                                  ? 'bg-white/15 text-[#f0f6ff] hover:bg-white/25'
                                  : 'bg-[#1e5080]/40 text-[#93b8d8] hover:bg-[#1e5080]/60'
                              }`}
                            >
                              {m.role}
                            </button>
                            <button
                              onClick={() => removeMembership(m.id)}
                              className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add membership */}
                  {addingMembership === u.id ? (
                    <div className="mt-3 flex gap-2">
                      <select
                        value={newMembership.body_id}
                        onChange={e => setNewMembership({ ...newMembership, body_id: e.target.value })}
                        className="flex-1 bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-2 py-1.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-1 focus:ring-[#c8102e] focus:border-[#c8102e]"
                      >
                        <option value="">Select Body</option>
                        {bodies
                            .filter(b => !u.board_memberships.some(m => m.bodies?.id === b.id))
                            .map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      <select
                        value={newMembership.role}
                        onChange={e => setNewMembership({ ...newMembership, role: e.target.value })}
                        className="bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-2 py-1.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-1 focus:ring-[#c8102e] focus:border-[#c8102e]"
                      >
                        <option value="Member">Member</option>
                        <option value="Leadership">Leadership</option>
                      </select>
                      <button
                        onClick={() => addMembership(u.id)}
                        disabled={!newMembership.body_id}
                        className="px-3 py-1.5 bg-[#0a1628] hover:bg-[#0f2040] text-white text-sm rounded-lg font-medium disabled:opacity-50 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setAddingMembership(null)}
                        className="px-3 py-1.5 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingMembership(u.id)}
                      className="mt-2 text-sm text-[#93b8d8] hover:text-[#c8102e] font-medium transition-colors"
                    >
                      + Add Membership
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}