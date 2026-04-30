export type UserRole = 'admin' | 'manager' | 'viewer' | 'participant';

export interface Session {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: UserRole;
  title: string;
  viewableManagers: { id: number; name: string; access: 'full' | 'own' }[];
  viewerManagerIds: number[];
  activeManagerId: number | null;
  accessToken: string;
}

export interface User {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  initials: string | null;
  title: string | null;
  role: UserRole;
  active: boolean;
  smsOptedOut?: boolean;
  createdAt: string;
  updatedAt: string;
  groups?: Group[];
}

export interface Group {
  id: number;
  name: string;
  description?: string | null;
  createdAt?: string;
}

export interface Participant {
  id: number;
  name: string;
  phone: string | null;
  active: boolean;
  smsOptedOut: boolean;
  groups?: Group[];
}

export interface Question {
  id: number;
  text: string;
  active: boolean;
  order: number;
  createdAt: string;
}

export interface Schedule {
  id: number;
  label: string;
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  recipientMode: 'all' | 'subset';
  active: boolean;
  createdAt: string;
  questions?: Question[];
  recipients?: Participant[];
}

export interface ManagerGroup {
  managerId: number;
  groupId: number;
  manager?: User;
  group?: Group;
}
