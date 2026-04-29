import React, { useState, useEffect, useCallback } from 'react'
import { useSession } from './SessionContext'
import { apiFetch } from '../lib/apiFetch'
import type { User, Group, Participant, Question, Schedule, ManagerGroup } from '../types'

interface AppDataContextValue {
  users: User[]
  groups: Group[]
  managerGroups: ManagerGroup[]
  participants: Participant[]
  questions: Question[]
  schedules: Schedule[]
  dataLoading: boolean
  refresh: () => Promise<void>
  token: string | null
}

const AppDataContext = React.createContext<AppDataContextValue | null>(null)

export const useAppData = () => {
  const v = React.useContext(AppDataContext)
  if (!v) throw new Error('useAppData must be used inside AppDataProvider')
  return v
}

export const AppDataProvider = ({ children }: { children: React.ReactNode }) => {
  const { session } = useSession()
  const token = session?.accessToken ?? null
  const role  = session?.role ?? null

  const [users,         setUsers]         = useState<User[]>([])
  const [groups,        setGroups]        = useState<Group[]>([])
  const [managerGroups, setManagerGroups] = useState<ManagerGroup[]>([])
  const [participants,  setParticipants]  = useState<Participant[]>([])
  const [questions,     setQuestions]     = useState<Question[]>([])
  const [schedules,     setSchedules]     = useState<Schedule[]>([])
  const [dataLoading,   setDataLoading]   = useState(false)

  const loadAll = useCallback(async () => {
    if (!token || !role) return
    setDataLoading(true)
    try {
      // participant only needs their own conversations — skip endpoints they can't access
      if (role === 'participant') { setDataLoading(false); return }

      const fetches: Promise<unknown>[] = [
        apiFetch('/groups?limit=500', token),
        apiFetch('/participants?limit=500', token),
        apiFetch('/questions?limit=500', token),
        apiFetch('/schedules?limit=500', token),
      ]
      if (role === 'admin') {
        fetches.push(
          apiFetch('/users?limit=500', token),
          apiFetch('/manager-groups', token),
        )
      }
      const [groupsRes, participantsRes, questionsRes, schedulesRes, usersRes, mgRes] = await Promise.all(fetches) as any[]
      setGroups(groupsRes?.data        ?? [])
      setParticipants(participantsRes?.data ?? [])
      setQuestions(questionsRes?.data   ?? [])
      setSchedules(schedulesRes?.data   ?? [])
      if (role === 'admin') {
        setUsers(usersRes?.data         ?? [])
        setManagerGroups(mgRes?.data    ?? [])
      }
    } catch (err) {
      console.error('[AppData] load failed:', err)
    } finally {
      setDataLoading(false)
    }
  }, [token, role])

  useEffect(() => { loadAll() }, [loadAll])

  return (
    <AppDataContext.Provider value={{
      users, groups, managerGroups, participants, questions, schedules,
      dataLoading, refresh: loadAll, token,
    }}>
      {children}
    </AppDataContext.Provider>
  )
}
