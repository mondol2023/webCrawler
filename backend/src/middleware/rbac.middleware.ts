import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../utils/jwt';

type Role = 'admin' | 'user';

/**
 * Usage: authorize('admin') or authorize('admin', 'user')
 */
export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user as JwtPayload | undefined;

    if (!user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: `Role '${user.role}' is not authorized to access this resource`,
      });
      return;
    }

    next();
  };
}