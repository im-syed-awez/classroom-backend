import express from "express";
import cors from "cors";

import subjectsRouter from "./routes/subjects.js";

const app = express();
const PORT = 8000;
const frontendUrl = process.env.FRONTEND_URL;
if (!frontendUrl) {
	throw new Error("Set FRONTEND_URL");
}
app.use(cors({
	origin: frontendUrl,
	methods: ['GET', 'POST', 'PUT', 'DELETE'],
	credentials: true
}));

app.use(express.json());
app.use('/api/subjects', subjectsRouter)

app.get("/", (req, res) => {
	res.send("Classroom Management API is running");
});

app.listen(PORT, () => {
	console.log(`Server is running at http://localhost:${PORT}`);
});
