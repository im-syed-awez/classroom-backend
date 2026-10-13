// This file will declare the user role for each request, it'll set by our authentication middleware later on

declare global {
    namespace Express {
        interface Request {
            user?: {
                role?:"admin" | "teacher" | "student";
            };
        }
    }
}
export {};