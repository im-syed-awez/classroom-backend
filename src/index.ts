import AgentAPI from "apminsight";
AgentAPI.config();

const { default: express } = await import("express");
const { default: cors } = await import("cors");
const { default: subjectsRouter } = await import("./routes/subjects.js");
const { default: securityMiddleware } = await import("./middleware/security.js");
const { toNodeHandler } = await import("better-auth/node");
const { auth } = await import("./lib/auth.js");

const app = express();
const PORT = 8000;
const frontendUrl = process.env.FRONTEND_URL;
if (!frontendUrl) {
	throw new Error("Set FRONTEND_URL in .env file");
}
app.use(cors({
	origin: frontendUrl,
	methods: ['GET', 'POST', 'PUT', 'DELETE'],
	credentials: true
}));

app.all('/api/auth/*splat', toNodeHandler(auth));
// With the path config, Any request matching that path will be handled by better auth for us. It'll authenticate users on our behalf. 

// We don't have to write any JWTs or handle sessions, Better Auth will do it.

app.use(express.json());

app.use(securityMiddleware);

app.use('/api/subjects', subjectsRouter)

app.get("/", (req, res) => {
	res.send("Classroom Management API is running");
});

app.listen(PORT, () => {
	console.log(`Server is running at http://localhost:${PORT}`);
});
