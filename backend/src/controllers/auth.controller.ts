import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User.model';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { logger } from '../utils/logger';
import { env } from '../config/env';

// ─── Validation Schemas ────────────────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Cookie Options ────────────────────────────────────────────────────────
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
};

// ─── Controllers ──────────────────────────────────────────────────────────
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ success: false, errors: body.error.flatten().fieldErrors });
      return;
    }

    const { name, email, password } = body.data;

    const exists = await User.findOne({ email });
    if (exists) {
      res.status(409).json({ success: false, message: 'Email already registered' });
      return;
    }

    const user = await User.create({ name, email, password });

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    res
      .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
      .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
      .status(201)
      .json({
        success: true,
        message: 'Registration successful',
        data: { user, accessToken },
      });
  } catch (error) {
    logger.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ success: false, errors: body.error.flatten().fieldErrors });
      return;
    }

    const { email, password } = body.data;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, message: 'Account is deactivated' });
      return;
    }

    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    res
      .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
      .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
      .json({
        success: true,
        message: 'Login successful',
        data: { user, accessToken },
      });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
}

export async function refreshToken(req: Request, res: Response): Promise<void> {
  try {
    const token: string | undefined =
      req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) {
      res.status(401).json({ success: false, message: 'Refresh token not provided' });
      return;
    }

    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.userId);

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'User not found or inactive' });
      return;
    }

    const accessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    res
      .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
      .cookie('refreshToken', newRefreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
      .json({ success: true, data: { accessToken } });
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
}

export async function logout(_req: Request, res: Response): Promise<void> {
  res
    .clearCookie('accessToken')
    .clearCookie('refreshToken')
    .json({ success: true, message: 'Logged out successfully' });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.user?.userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    res.json({ success: true, data: { user } });
  } catch (error) {
    logger.error('GetMe error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}