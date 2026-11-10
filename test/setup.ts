const testEnv = process.env as Record<string, string | undefined>;
testEnv.NODE_ENV = "test";
testEnv.AUTH_SESSION_SECRET = "test-session-secret";
testEnv.FRONTEND_ORIGIN = "http://localhost:3000";
