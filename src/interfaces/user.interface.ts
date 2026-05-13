export type UserRole = 'admin' | 'parent' | 'kid';

export interface IUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: UserRole;
  is_verified: boolean;
  createdAt: Date;
  // Optional fields for kid users
  username?: string;      // For kid login (instead of email)
  pin?: string;           // For kid login (PIN code)
  parent_id?: string;     // Reference to parent for kid accounts
  age?: number;           // Kid's age
  grade?: string;         // Kid's grade level
}

export interface IJWTPayload {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  // For kid JWTs
  kid_id?: string;        // Kid's ID for kid role
  parent_id?: string;     // Parent's ID for kid role
  username?: string;      // Kid's username
  iat?: number;
  exp?: number;
}

// Kid login specific interface
export interface KidLoginPayload {
  username: string;
  pin: string;
}

// Kid registration interface (created by parent)
export interface KidRegistrationPayload {
  name: string;
  age?: number;
  grade?: string;
  username: string;
  pin: string;
  parent_id: string;
}