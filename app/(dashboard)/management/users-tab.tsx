'use client'

import { useEffect, useState } from 'react'

const ADMIN_ROLES = [
  'Vice President of Operational Affairs',
  'Comptroller',
  'Digital Innovation Project Member',
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

  const fetchUsers = async () => {
    const res = await fetch('/api/management/users')
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }

  const fetchBodies = async () => {
    const res = await fetch('/api/management/bodies')
    const data = await res.json()
    setBodies(data.bodies || [])
  }

  useEffect(() => {
    fetchUsers()
    fetchBodies()
  }, [])

  const createUser = async () => {
    setCreating(true)
    await fetch('/api/management/users', {
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
    await fetch('/api/management/users/memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...newMembership }),
    })
    setNewMembership({ body_id: '', role: 'Member' })
    setAddingMembership(null)
    await fetchUsers()
  }

  const removeMembership = async (membershipId: string) => {
    await fetch('/api/management/users/memberships', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: membershipId }),
    })
    await fetchUsers()
  }

  const toggleMembershipRole = async (membershipId: string, currentRole: string) => {
    const newRole = currentRole === 'Leadership' ? 'Member' : 'Leadership'
    await fetch('/api/management/users/memberships', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: membershipId, role: newRole }),
    })
    await fetchUsers()
  }

  if (loading) return <div className="text-slate-500 text-sm">Loading...</div>

  const inputCls = "w-full border border-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/20 focus:border-[#c8102e] transition"

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
        <div className="border border-[#e2e8f0] rounded-xl p-5 bg-slate-50 space-y-3">
          <h3 className="font-semibold text-[#0f172a]">Create New User</h3>
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
              className="px-4 py-2 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users list */}
      {users.length === 0 ? (
        <p className="text-slate-400 text-sm">No users found.</p>
      ) : (
        users.map(u => (
          <div key={u.id} className="border border-[#e2e8f0] rounded-xl bg-white shadow-sm">
            {/* User row */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 rounded-xl transition-colors"
              onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
            >
              <div>
                <p className="font-semibold text-[#0f172a]">{u.full_name}</p>
                <p className="text-sm text-slate-500">{u.email}</p>
                {u.admin_role && (
                  <p className="text-xs text-[#c8102e] font-medium mt-0.5">{u.admin_role}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-slate-400 text-xs">{expandedUser === u.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded section */}
            {expandedUser === u.id && (
              <div className="border-t border-[#e2e8f0] px-4 py-4 space-y-4 bg-slate-50/50 rounded-b-xl">
                {/* Body memberships */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Body Memberships</h4>
                  {u.board_memberships.length === 0 ? (
                    <p className="text-sm text-slate-400">No memberships assigned.</p>
                  ) : (
                    <div className="space-y-2">
                      {u.board_memberships.map(m => (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700">{m.bodies?.name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleMembershipRole(m.id, m.role)}
                              className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                                m.role === 'Leadership'
                                  ? 'bg-[#0a1628]/10 text-[#0a1628] hover:bg-[#0a1628]/20'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                        className="flex-1 border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#c8102e] focus:border-[#c8102e]"
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
                        className="border border-[#e2e8f0] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#c8102e] focus:border-[#c8102e]"
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
                        className="px-3 py-1.5 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingMembership(u.id)}
                      className="mt-2 text-sm text-[#0a1628] hover:text-[#c8102e] font-medium transition-colors"
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