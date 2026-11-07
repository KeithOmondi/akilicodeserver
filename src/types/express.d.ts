import { IUser } from '../../interfaces/user.interface';
import { IKid } from '../../interfaces/kid.interface';

declare global {
  namespace Express {
    interface Request {
      user?: IUser | IKid;
    }
  }
}

export {}; // ← makes this a module, activating the global augmentation