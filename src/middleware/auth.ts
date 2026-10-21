import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

const roles = ["admin", "teacher", "student"] as const;

export const resolveIdentity = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session && roles.includes(session.user.role as (typeof roles)[number])) {
      req.user = {
        id: session.user.id,
        role: session.user.role as (typeof roles)[number],
      };
    }

    next();
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(500).json({ error: "Unable to verify session" });
  }
};

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  next();
};

export const requireRole = (...allowedRoles: Array<"admin" | "teacher" | "student">) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };