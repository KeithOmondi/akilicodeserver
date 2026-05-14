// types/express/index.d.ts
import { IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

declare global {
  namespace Express {
    interface Request {
      user?: IUser | IKid;  // for parent/admin routes
      kid?: IKid;           // for kid-specific routes
    }
  }
}

export {};