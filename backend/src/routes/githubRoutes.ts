import { Router } from "express";
import { postGithubDependencies } from "../controllers/dependencyController.js";
import { postGithubTree } from "../controllers/githubController.js";
import { postGithubWorkflows } from "../controllers/workflowController.js";

const router = Router();

router.post("/github/tree", postGithubTree);
router.post("/github/dependencies", postGithubDependencies);
router.post("/github/workflows", postGithubWorkflows);

export default router;
