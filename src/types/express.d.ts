import { IUser } from '../interfaces/user.interface';

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

// This empty export is a trick to tell TS to treat this as a module
export {};