// We have created type for the user role 
type UserRoles = "admin" | "teacher" | "student";
// as well as the rate limit role which can be either one of these 3 or just guest.
type RateLimitRole = UserRoles | "guest";