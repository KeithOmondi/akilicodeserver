import { IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

declare global {
  namespace Express {
    interface Request {
      // The current session entity could be a User or a Kid
      user?: IUser | IKid;
    }
  }
}

export {};