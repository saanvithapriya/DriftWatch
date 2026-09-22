import { Router } from "express";
import { postGithubTree } from "../controllers/githubController.js";

const router = Router();

router.post("/github/tree", postGithubTree);

export default router;
