export type UserRole = 'admin' | 'parent';

export interface IUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: UserRole;
  is_verified: boolean;        // ← add this
  createdAt: Date;
}

export interface IJWTPayload {
  id: string;
  name: string;   // Added: To display on the UI immediately
  role: UserRole;
  phone: string;
  iat?: number;
  exp?: number;
}