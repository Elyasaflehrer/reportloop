import { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { Tab } from '../ui/Tab'
import { AdminUsersTab } from './AdminUsersTab'
import { AdminGroupsTab } from './AdminGroupsTab'
import { AdminManagerGroupsTab } from './AdminManagerGroupsTab'
import { AdminCorrespondencesHierarchy } from './AdminCorrespondencesHierarchy'
import { Integrations } from '../Integrations'

interface Props {
  onNav?: (page: string) => void
}

export const AdminDashboard = ({ onNav }: Props) => {
  const { users, groups, managerGroups } = useAppData()
  const [tab, setTab] = useState('users')

  const groupsCount = groups.length
  const managerGroupLinksCount = managerGroups.length
  const userGroupMembershipsCount = groups.reduce((acc, g) => acc + ((g as any).memberIds || []).length, 0)
  const viewers = users.filter(u => u.role === 'viewer')
  const viewersWithCoverage = viewers.filter(u => {
    const userGroupIds = groups.filter(g => ((g as any).memberIds || []).includes(u.id)).map(g => g.id)
    return userGroupIds.some(gid => managerGroups.some(mg => mg.groupId === gid))
  }).length

  const setupItems = [
    { key: 'groups', label: 'Property groups created', done: groupsCount > 0, actionTab: 'groups', hint: `${groupsCount} group${groupsCount !== 1 ? 's' : ''}` },
    { key: 'mlinks', label: 'Managers assigned to groups', done: managerGroupLinksCount > 0, actionTab: 'mlinks', hint: `${managerGroupLinksCount} assignment${managerGroupLinksCount !== 1 ? 's' : ''}` },
    { key: 'users', label: 'Team members added to groups', done: userGroupMembershipsCount > 0, actionTab: 'users', hint: `${userGroupMembershipsCount} member${userGroupMembershipsCount !== 1 ? 's' : ''}` },
    {
      key: 'viewerCoverage',
      label: 'Report viewers have access',
      done: viewers.length === 0 ? true : viewersWithCoverage === viewers.length,
      actionTab: 'users',
      hint: viewers.length ? `${viewersWithCoverage} of ${viewers.length} viewer${viewers.length !== 1 ? 's' : ''} configured` : 'No viewers yet',
    },
  ]

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Admin</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>Manage your team, property groups, and who can see which reports.</p>
      </div>

      {/* Setup progress */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16, boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Setup progress</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {setupItems.map((item, idx) => (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', minWidth: 18 }}>{idx + 1}.</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', borderRadius: 99, padding: '2px 8px', background: item.done ? 'var(--green-bg)' : 'var(--border)', color: item.done ? 'var(--green)' : 'var(--text-3)' }}>
                {item.done ? 'Complete' : 'Not started'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{item.hint}</span>
              <button type="button" onClick={() => setTab(item.actionTab)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                Go to {item.actionTab === 'mlinks' ? 'Manager groups' : item.actionTab === 'groups' ? 'Groups' : 'Users'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content', boxShadow: 'var(--shadow)', flexWrap: 'wrap' }}>
        <Tab label="Users & roles"    active={tab === 'users'}  onClick={() => setTab('users')} />
        <Tab label="Groups"           active={tab === 'groups'} onClick={() => setTab('groups')} />
        <Tab label="Manager groups"   active={tab === 'mlinks'} onClick={() => setTab('mlinks')} />
        <Tab label="Correspondences"  active={tab === 'corr'}   onClick={() => setTab('corr')} />
        <Tab label="Integrations"     active={tab === 'int'}    onClick={() => setTab('int')} />
      </div>

      {tab === 'users'  && <AdminUsersTab />}
      {tab === 'groups' && <AdminGroupsTab />}
      {tab === 'mlinks' && <AdminManagerGroupsTab />}
      {tab === 'corr'   && <AdminCorrespondencesHierarchy />}
      {tab === 'int'    && (
        <div style={{ maxWidth: 480 }}>
          <p style={{ color: 'var(--text-2)', marginBottom: 16 }}>Open the full Integrations screen (Twilio, etc.) in the main layout.</p>
          <button type="button" onClick={() => onNav?.('integrations')} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 14 }}>
            Open Integrations
          </button>
        </div>
      )}
    </div>
  )
}
